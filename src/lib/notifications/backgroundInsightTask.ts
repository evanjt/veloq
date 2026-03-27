import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug } from '@/lib';
import {
  computeInsightsFromData,
  fetchInsightsDataFromEngine,
} from '@/hooks/insights/computeInsightsData';
import type { WellnessInput } from '@/hooks/insights/computeInsightsData';
import { formatInsightNotification, pickBestInsightForNotification } from './insightNotification';
import { presentInsightNotification } from './notificationService';
import { computeInsightFingerprint } from '@/providers/InsightsStore';
import type { NotificationPreferences } from '@/providers/NotificationPreferencesStore';
import type { Insight } from '@/types';

const log = debug.create('BackgroundInsight');

export const BACKGROUND_INSIGHT_TASK = 'veloq-background-insight';

const FINGERPRINT_KEY = 'veloq-insights-fingerprint';
const PREFS_KEY = 'veloq-notification-preferences';

/**
 * Category → preference key mapping for all insight types.
 * Categories without a preference key are always allowed.
 */
const CATEGORY_PREFS: Record<string, keyof NotificationPreferences['categories'] | null> = {
  section_pr: 'sectionPr',
  fitness_milestone: 'fitnessMilestone',
  period_comparison: 'periodComparison',
  activity_pattern: 'activityPattern',
  tsb_form: null,
  hrv_trend: null,
  stale_pr: null,
  section_cluster: null,
  efficiency_trend: null,
};

/** Max time to wait for GPS download (15 seconds) */
const GPS_DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * Read notification preferences directly from AsyncStorage.
 * In background context, Zustand store may not be initialized.
 */
async function readPrefsFromStorage(): Promise<NotificationPreferences | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NotificationPreferences;
  } catch {
    return null;
  }
}

interface ActivityInfo {
  name: string;
  type: string;
  ingested: boolean;
}

/**
 * Fetch activity metadata and download GPS into the Rust engine.
 * Returns activity info for notification enrichment, or null on failure.
 */
async function fetchAndIngestActivity(activityId: string): Promise<ActivityInfo | null> {
  try {
    const { getStoredCredentials } = require('@/providers/AuthStore');
    const creds = getStoredCredentials();
    if (!creds.athleteId) return null;

    // Build auth header
    let authHeader: string;
    if (creds.authMethod === 'oauth' && creds.accessToken) {
      authHeader = `Bearer ${creds.accessToken}`;
    } else if (creds.apiKey) {
      const encoded = btoa(`API_KEY:${creds.apiKey}`);
      authHeader = `Basic ${encoded}`;
    } else {
      return null;
    }

    // Fetch activity metadata
    const { intervalsApi } = require('@/api');
    const activity = await intervalsApi.getActivity(activityId);
    if (!activity) return null;

    const activityInfo: ActivityInfo = {
      name: activity.name ?? 'Activity',
      type: activity.type ?? 'Ride',
      ingested: false,
    };

    // Download GPS in Rust (direct to SQLite, ~150ms for one activity)
    const {
      startFetchAndStore,
      getDownloadProgress,
      takeFetchAndStoreResult,
      routeEngine,
    } = require('veloqrs');

    startFetchAndStore(authHeader, [activityId], [{ activityId, sportType: activityInfo.type }]);

    // Busy-wait for Rust thread (setTimeout unreliable when backgrounded)
    const startTime = Date.now();
    while (Date.now() - startTime < GPS_DOWNLOAD_TIMEOUT_MS) {
      await Promise.resolve();
      const progress = getDownloadProgress();
      if (!progress.active) break;
      const busyEnd = Date.now() + 50;
      while (Date.now() < busyEnd) {
        /* spin */
      }
    }

    const result = takeFetchAndStoreResult();
    if (result && result.successCount > 0) {
      const { toActivityMetrics } = require('@/lib/utils/activityMetrics');
      routeEngine.setActivityMetrics([toActivityMetrics(activity)]);
      routeEngine.triggerRefresh('activities');
      activityInfo.ingested = true;
      log.log(
        `Activity ingested: ${activityInfo.name} (${result.totalPoints} GPS points, ${Date.now() - startTime}ms)`
      );
    }

    return activityInfo;
  } catch (e) {
    log.warn('Activity fetch/ingest failed:', e);
    return null;
  }
}

/**
 * Build an activity-centric notification body.
 * Queries the engine to find section PRs and matches for THIS specific activity,
 * rather than relying on generic insight fingerprint diffing.
 */
function buildActivityNotificationBody(
  activityId: string,
  activityName: string,
  newInsights: Insight[]
): string {
  try {
    const { routeEngine } = require('veloqrs');

    // Check which sections this activity traversed (exclude disabled)
    const { useDisabledSections } = require('@/providers');
    const disabledIds = useDisabledSections.getState().disabledIds;
    const allSections = routeEngine.getSectionsForActivity(activityId);
    const sections = allSections?.filter((s: { id: string }) => !disabledIds.has(s.id));
    if (sections && sections.length > 0) {
      // Check for PRs on these sections
      let prCount = 0;
      let prSectionName = '';
      for (const section of sections) {
        try {
          const perf = routeEngine.getSectionPerformances(section.id);
          if (perf?.bestRecord?.activityId === activityId) {
            prCount++;
            if (!prSectionName) prSectionName = section.name || 'a section';
          }
        } catch {
          // Skip sections where performance check fails
        }
      }

      if (prCount > 0) {
        if (prCount === 1) {
          return `${activityName} — PR on ${prSectionName}`;
        }
        return `${activityName} — PR on ${prCount} sections`;
      }

      // No PRs but has section matches
      if (sections.length === 1) {
        return `${activityName} — 1 section traversed`;
      }
      return `${activityName} — ${sections.length} sections traversed`;
    }
  } catch {
    // Engine query failed, fall through
  }

  // Check for new insights caused by this activity
  const milestone = newInsights.find((i) => i.category === 'fitness_milestone');
  if (milestone) {
    return `${activityName} — ${milestone.title}`;
  }

  return activityName;
}

/**
 * Background task that processes new activities and generates insight notifications.
 *
 * Called when a silent push arrives from auth.veloq.fit (webhook relay).
 * Runs outside React — no hooks, no providers, no context.
 *
 * Flow:
 *   1. Check notification preferences
 *   2. If activity event: download GPS, ingest into engine
 *   3. Fetch fresh wellness data from intervals.icu
 *   4. Generate insights (now including the new activity)
 *   5. Present notification with deep link to activity
 */
TaskManager.defineTask(BACKGROUND_INSIGHT_TASK, async ({ data, error }) => {
  if (error) {
    log.error('Background insight error:', error.message);
    return;
  }

  try {
    // 1. Read preferences directly from AsyncStorage (Zustand may not be hydrated)
    const prefs = await readPrefsFromStorage();
    if (!prefs?.enabled) {
      log.log('Notifications disabled, skipping');
      return;
    }

    // 2. Extract push payload
    // expo-notifications wraps data inside data.dataString as a JSON string
    const taskPayload = data as
      | { data?: { dataString?: string }; notification?: unknown }
      | undefined;
    let activityId: string | undefined;
    let eventType: string | undefined;

    try {
      const raw = taskPayload?.data?.dataString;
      if (raw) {
        const parsed = JSON.parse(raw);
        activityId = parsed.activity_id ?? undefined;
        eventType = parsed.event_type ?? undefined;
      }
    } catch {
      log.warn('Could not parse push payload');
    }

    log.log(`Push received: event=${eventType}, activity=${activityId}`);
    const isActivityEvent = eventType === 'ACTIVITY_UPLOADED' || eventType === 'ACTIVITY_ANALYZED';

    // 3. Get i18n translation function (standalone, no React)
    const { i18n } = require('@/i18n');
    const t = i18n.t.bind(i18n) as (
      key: string,
      params?: Record<string, string | number>
    ) => string;

    // 4. If activity event, fetch metadata + download GPS into engine
    let activityInfo: ActivityInfo | null = null;
    if (isActivityEvent && activityId) {
      activityInfo = await fetchAndIngestActivity(activityId);
    }

    // 5. Fetch fresh wellness data from intervals.icu API
    let wellnessData: WellnessInput[] | null = null;
    try {
      const { intervalsApi } = require('@/api');
      const wellness = await intervalsApi.getWellness();
      wellnessData = wellness as WellnessInput[];
    } catch (e) {
      log.warn('Could not fetch wellness data:', e);
    }

    // 6. Generate insights (now includes new activity if ingested)
    const ffiData = fetchInsightsDataFromEngine();
    const insights = ffiData ? computeInsightsFromData(ffiData, wellnessData, t) : [];

    // 7. Find insights that are NEW (caused by this activity)
    const storedFingerprint = await AsyncStorage.getItem(FINGERPRINT_KEY);
    const previousIds = new Set((storedFingerprint ?? '').split('|'));
    const newInsights = insights.filter((i) => !previousIds.has(i.id));

    // 8. Build activity-centric notification
    if (isActivityEvent) {
      const activityName = activityInfo?.name ?? t('notifications.activityRecorded.title');
      const body = buildActivityNotificationBody(activityId!, activityName, newInsights);

      await presentInsightNotification(t('notifications.activityRecorded.title'), body, {
        route: activityId ? `/activity/${activityId}` : '/',
        activityId: activityId || undefined,
      });
      log.log(`Notification sent: ${body}`);
    } else if (newInsights.length > 0) {
      // Non-activity event (fitness update, wellness change) with new insights
      const bestInsight = pickBestInsightForNotification(newInsights);
      if (bestInsight) {
        const content = formatInsightNotification(bestInsight, t);
        await presentInsightNotification(content.title, content.body, content.data);
        log.log(`Notification sent: ${content.title} — ${content.body}`);
      }
    } else {
      log.log('No notification content to show');
    }

    // 9. Update stored fingerprint
    const currentFingerprint = insights.length > 0 ? computeInsightFingerprint(insights) : '';
    if (currentFingerprint) {
      await AsyncStorage.setItem(FINGERPRINT_KEY, currentFingerprint);
    }
  } catch (e) {
    log.error('Background insight task failed:', e);
  }
});

/**
 * Register the background notification task with expo-notifications.
 * Must be called once at app startup (in _layout.tsx).
 */
export async function registerBackgroundNotificationTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_INSIGHT_TASK);
    if (!isRegistered) {
      await Notifications.registerTaskAsync(BACKGROUND_INSIGHT_TASK);
      log.log('Background notification task registered');
    }
  } catch (e) {
    log.warn('Could not register background notification task:', e);
  }
}
