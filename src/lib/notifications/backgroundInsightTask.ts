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

/**
 * Download and ingest a single activity into the Rust engine.
 * Uses startFetchAndStore() for direct Rust→SQLite GPS storage.
 * Returns true if successful.
 */
async function ingestActivity(activityId: string): Promise<boolean> {
  try {
    const { getStoredCredentials } = require('@/providers/AuthStore');
    const creds = getStoredCredentials();
    if (!creds.athleteId) return false;

    // Build auth header
    let authHeader: string;
    if (creds.authMethod === 'oauth' && creds.accessToken) {
      authHeader = `Bearer ${creds.accessToken}`;
    } else if (creds.apiKey) {
      const encoded = btoa(`API_KEY:${creds.apiKey}`);
      authHeader = `Basic ${encoded}`;
    } else {
      log.warn('No credentials for activity ingestion');
      return false;
    }

    // Fetch activity metadata to get sport type
    const { intervalsApi } = require('@/api');
    const activity = await intervalsApi.getActivity(activityId);
    if (!activity) return false;

    const sportType = activity.type ?? 'Ride';

    // Start GPS download in Rust (direct to SQLite, no JS round-trip)
    const {
      startFetchAndStore,
      getDownloadProgress,
      takeFetchAndStoreResult,
      routeEngine,
    } = require('veloqrs');

    startFetchAndStore(authHeader, [activityId], [{ activityId, sportType }]);

    // Poll until complete or timeout
    const startTime = Date.now();
    while (Date.now() - startTime < GPS_DOWNLOAD_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const progress = getDownloadProgress();
      if (!progress.active) break;
    }

    // Get result
    const result = takeFetchAndStoreResult();
    if (!result || result.successCount === 0) {
      log.warn('GPS download failed or timed out');
      return false;
    }

    // Set activity metrics in engine
    const { toActivityMetrics } = require('@/lib/utils/activityMetrics');
    const metrics = toActivityMetrics(activity);
    routeEngine.setActivityMetrics([metrics]);
    routeEngine.triggerRefresh('activities');

    log.log(`Activity ${activityId} ingested: ${result.totalPoints} GPS points`);
    return true;
  } catch (e) {
    log.warn('Activity ingestion failed:', e);
    return false;
  }
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
    const pushData = data as { activity_id?: string; event_type?: string } | undefined;
    const activityId = pushData?.activity_id;
    const eventType = pushData?.event_type;
    const isActivityEvent = eventType === 'ACTIVITY_UPLOADED' || eventType === 'ACTIVITY_ANALYZED';

    // 3. If activity event, download and ingest the new activity
    if (isActivityEvent && activityId) {
      const ingested = await ingestActivity(activityId);
      if (ingested) {
        log.log('New activity ingested into engine');
      } else {
        log.log('Activity ingestion skipped — will sync on next app open');
      }
    }

    // 4. Get i18n translation function (standalone, no React)
    const { i18n } = require('@/i18n');
    const t = i18n.t.bind(i18n) as (
      key: string,
      params?: Record<string, string | number>
    ) => string;

    // 5. Fetch fresh wellness data from intervals.icu API
    let wellnessData: WellnessInput[] | null = null;
    try {
      const { intervalsApi } = require('@/api');
      const wellness = await intervalsApi.getWellness();
      wellnessData = wellness as WellnessInput[];
    } catch (e) {
      log.warn('Could not fetch wellness data:', e);
    }

    // 6. Get insight data from engine (now includes the new activity if ingested)
    const ffiData = fetchInsightsDataFromEngine();
    if (!ffiData) {
      // Engine not ready — still notify about the activity
      if (isActivityEvent) {
        await presentInsightNotification(
          t('notifications.activityRecorded.title'),
          t('notifications.activityRecorded.body'),
          { route: '/', activityId: activityId ?? undefined }
        );
        log.log('Notification sent: activity recorded (engine not ready)');
      }
      return;
    }

    // 7. Generate insights with fresh wellness + new activity data
    const insights = computeInsightsFromData(ffiData, wellnessData, t);

    // 8. Compare fingerprint to detect new insights
    const currentFingerprint = insights.length > 0 ? computeInsightFingerprint(insights) : '';
    const storedFingerprint = await AsyncStorage.getItem(FINGERPRINT_KEY);

    const previousIds = new Set((storedFingerprint ?? '').split('|'));
    const newInsights = insights.filter((i) => !previousIds.has(i.id));
    const bestInsight = pickBestInsightForNotification(
      newInsights.length > 0 ? newInsights : insights
    );

    // 9. Present notification
    if (bestInsight) {
      const prefKey = CATEGORY_PREFS[bestInsight.category];
      if (prefKey && !prefs.categories[prefKey]) {
        // Category disabled — show generic activity notification instead
        if (isActivityEvent) {
          await presentInsightNotification(
            t('notifications.activityRecorded.title'),
            t('notifications.activityRecorded.body'),
            { route: '/', activityId: activityId ?? undefined }
          );
          log.log('Notification sent: activity recorded (insight category disabled)');
        }
      } else {
        // Show the insight, deep linking to activity if available
        const content = formatInsightNotification(bestInsight, t);
        if (activityId) {
          content.data.activityId = activityId;
        }
        await presentInsightNotification(content.title, content.body, content.data);
        log.log(`Notification sent: ${content.title} — ${content.body}`);
      }
    } else if (isActivityEvent) {
      await presentInsightNotification(
        t('notifications.activityRecorded.title'),
        t('notifications.activityRecorded.body'),
        { route: '/', activityId: activityId ?? undefined }
      );
      log.log('Notification sent: activity recorded (no insights)');
    } else {
      log.log('No notification content to show');
    }

    // 10. Update stored fingerprint
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
