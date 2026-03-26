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
const QUEUED_ACTIVITIES_KEY = 'veloq-queued-activity-ids';

/**
 * Category → preference key mapping for all insight types.
 * Categories without a preference key are always allowed.
 */
const CATEGORY_PREFS: Record<string, keyof NotificationPreferences['categories'] | null> = {
  section_pr: 'sectionPr',
  fitness_milestone: 'fitnessMilestone',
  period_comparison: 'periodComparison',
  activity_pattern: 'activityPattern',
  // These categories notify unless the master toggle is off
  tsb_form: null,
  hrv_trend: null,
  stale_pr: null,
  section_cluster: null,
  efficiency_trend: null,
};

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
 * Queue an activity ID for processing on next app open.
 * Used when background task can't complete (offline, engine busy).
 */
async function queueActivityId(activityId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUED_ACTIVITIES_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(activityId)) {
      ids.push(activityId);
      await AsyncStorage.setItem(QUEUED_ACTIVITIES_KEY, JSON.stringify(ids));
    }
  } catch {
    // Best-effort
  }
}

/**
 * Get and clear queued activity IDs (called on app open from GlobalDataSync).
 */
export async function takeQueuedActivityIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUED_ACTIVITIES_KEY);
    if (!raw) return [];
    await AsyncStorage.removeItem(QUEUED_ACTIVITIES_KEY);
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Background task that generates insights and presents a local notification.
 *
 * Called when a silent push arrives from auth.veloq.fit (webhook relay).
 * Runs outside React — no hooks, no providers, no context.
 *
 * The background task refreshes wellness/fitness data from intervals.icu and
 * regenerates insights. Fitness milestones (FTP increase), form changes
 * (CTL/ATL/TSB), and weekly comparisons are detected immediately.
 *
 * Section PRs require GPS ingestion into the Rust engine, which happens on
 * next app open via GlobalDataSync. The new activity ID is queued so it can
 * be prioritised during the next sync.
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

    // 2. Extract activity ID from push payload for queuing
    const pushData = data as { activity_id?: string } | undefined;
    const activityId = pushData?.activity_id;

    // 3. Queue the activity ID for prioritised sync on next app open
    // GPS ingestion (needed for section PRs) runs in foreground sync
    if (activityId) {
      await queueActivityId(activityId);
    }

    // 4. Get i18n translation function (standalone, no React)
    const { i18n } = require('@/i18n');
    const t = i18n.t.bind(i18n) as (
      key: string,
      params?: Record<string, string | number>
    ) => string;

    // 5. Fetch fresh wellness data from intervals.icu API
    // FTP, CTL, ATL, TSB, HRV are computed server-side by intervals.icu
    let wellnessData: WellnessInput[] | null = null;
    try {
      const { intervalsApi } = require('@/api');
      const wellness = await intervalsApi.getWellness();
      wellnessData = wellness as WellnessInput[];
    } catch (e) {
      log.warn('Could not fetch wellness data:', e);
      // If offline, skip insight generation — queue for next app open
      if (activityId) {
        log.log('Activity queued for next app open');
      }
      return;
    }

    // 6. Get insight data from engine (reads existing SQLite data)
    const ffiData = fetchInsightsDataFromEngine();
    if (!ffiData) {
      log.log('Engine not ready, activity queued for next app open');
      return;
    }

    // 7. Generate insights with fresh wellness data
    const insights = computeInsightsFromData(ffiData, wellnessData, t);
    if (insights.length === 0) {
      log.log('No insights generated');
      return;
    }

    // 8. Compare fingerprint to detect new insights
    const currentFingerprint = computeInsightFingerprint(insights);
    const storedFingerprint = await AsyncStorage.getItem(FINGERPRINT_KEY);

    if (currentFingerprint === storedFingerprint) {
      log.log('No new insights (fingerprint unchanged)');
      return;
    }

    // 9. Find the best NEW insight to notify about
    const previousIds = new Set((storedFingerprint ?? '').split('|'));
    const newInsights = insights.filter((i) => !previousIds.has(i.id));
    const bestInsight = pickBestInsightForNotification(newInsights);

    if (!bestInsight) {
      log.log('No notification-worthy insights');
      await AsyncStorage.setItem(FINGERPRINT_KEY, currentFingerprint);
      return;
    }

    // 10. Check category preference
    const prefKey = CATEGORY_PREFS[bestInsight.category];
    if (prefKey && !prefs.categories[prefKey]) {
      log.log(`Category ${bestInsight.category} disabled, skipping notification`);
      await AsyncStorage.setItem(FINGERPRINT_KEY, currentFingerprint);
      return;
    }

    // 11. Present local notification
    const content = formatInsightNotification(bestInsight, t);
    await presentInsightNotification(content.title, content.body, content.data);
    log.log(`Notification sent: ${content.title} — ${content.body}`);

    // 12. Update stored fingerprint
    await AsyncStorage.setItem(FINGERPRINT_KEY, currentFingerprint);
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
