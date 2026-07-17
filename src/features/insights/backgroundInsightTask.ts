import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { debug } from '@/shared/debug/debug';
import {
  presentActivityNotification,
  presentInsightNotification,
} from '@/features/settings/lib/notificationService';
import type { NotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

import { buildActivityNotificationBody } from './lib/activityNotificationBody';
import type { ActivityInfo } from './lib/activityNotificationBody';
import { computeInsightsFromData, fetchInsightsDataFromEngine } from './lib/computeInsightsData';
import type { WellnessInput } from './lib/computeInsightsData';
import {
  filterInsightsForNotificationPreferences,
  formatInsightNotification,
  isPushAllowed,
  pickBestInsightForNotification,
  prunePushHistory,
} from './notifications';
import { computeInsightFingerprint } from './store';
const log = debug.create('BackgroundInsight');

export const BACKGROUND_INSIGHT_TASK = 'veloq-background-insight';

const FINGERPRINT_KEY = 'veloq-insights-fingerprint';
const PREFS_KEY = 'veloq-notification-preferences';
/** History of recent push timestamps (ms epoch) for D11 cooldown enforcement. */
const PUSH_HISTORY_KEY = 'veloq-insight-push-history';

async function readPushHistory(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(PUSH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  } catch {
    return [];
  }
}

async function appendPushHistory(ts: number): Promise<void> {
  try {
    const existing = await readPushHistory();
    const pruned = prunePushHistory([...existing, ts], ts);
    await AsyncStorage.setItem(PUSH_HISTORY_KEY, JSON.stringify(pruned));
  } catch (e) {
    log.warn('Could not persist push history:', e);
  }
}

/** Max time to wait for GPS download (15 seconds) */
const GPS_DOWNLOAD_TIMEOUT_MS = 15_000;
const GPS_DOWNLOAD_POLL_MS = 250;

/**
 * Max time to wait for section detection (15 seconds). The OS gives a silent
 * push handler a limited budget, so we bound the wait rather than blocking on a
 * full library re-detection. If detection runs long the engine keeps going in
 * the background; the notification body just falls back to non-PR content.
 */
const SECTION_DETECTION_TIMEOUT_MS = 15_000;
const SECTION_DETECTION_POLL_MS = 500;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDownloadCompletion(
  getDownloadProgress: () => { active: boolean }
): Promise<boolean> {
  const deadline = Date.now() + GPS_DOWNLOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const progress = getDownloadProgress();
    if (!progress.active) {
      return true;
    }
    await sleep(GPS_DOWNLOAD_POLL_MS);
  }
  return false;
}

/**
 * Run section detection for a freshly ingested activity so its section PRs are
 * available when buildActivityNotificationBody queries getSectionsForActivity.
 * Without this, a brand-new activity has GPS in the DB but no section rows yet,
 * so the notification omits any PR it just set.
 *
 * Uses the same start/poll loop as the foreground sync path. Bounded by
 * SECTION_DETECTION_TIMEOUT_MS so the background task is not killed.
 */
async function runSectionDetection(routeEngine: {
  startSectionDetection: () => boolean;
  pollSectionDetection: () => string;
  triggerRefresh: (target: string) => void;
}): Promise<void> {
  let started = routeEngine.startSectionDetection();
  if (!started) {
    // A stale completed run can block a fresh start. Drain it and retry, same
    // as the foreground fetcher.
    const drainStatus = routeEngine.pollSectionDetection();
    if (drainStatus === 'complete') {
      routeEngine.triggerRefresh('sections');
      routeEngine.triggerRefresh('groups');
      started = routeEngine.startSectionDetection();
    }
  }
  if (!started) return;

  const deadline = Date.now() + SECTION_DETECTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = routeEngine.pollSectionDetection();
    if (status === 'complete' || status === 'idle') {
      return;
    }
    if (status === 'error') {
      log.warn('Section detection returned error status');
      return;
    }
    await sleep(SECTION_DETECTION_POLL_MS);
  }
  log.warn(`Section detection did not finish within ${SECTION_DETECTION_TIMEOUT_MS}ms`);
}

/**
 * Fetch activity metadata and download GPS into the Rust engine.
 * Returns activity info for notification enrichment, or null on failure.
 */
async function fetchAndIngestActivity(activityId: string): Promise<ActivityInfo | null> {
  try {
    const { getStoredCredentials } = require('@/shared/app/AuthStore');
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
      distance: typeof activity.distance === 'number' ? activity.distance : undefined,
      movingTime: typeof activity.moving_time === 'number' ? activity.moving_time : undefined,
    };

    const {
      startFetchAndStore,
      getDownloadProgress,
      takeFetchAndStoreResult,
      routeEngine,
    } = require('veloqrs');

    // Skip GPS download if we already have this activity in SQLite — the
    // enrichment path reads sections from the DB, so a re-delivered webhook
    // (or duplicate silent push) produces the same enriched output without
    // a pointless 150–15000ms network roundtrip.
    const alreadyIngested = (() => {
      try {
        return routeEngine.getActivityIds().includes(activityId);
      } catch {
        return false;
      }
    })();

    if (alreadyIngested) {
      activityInfo.ingested = true;
      log.log(`Activity already in DB, skipping download: ${activityInfo.name}`);
      return activityInfo;
    }

    startFetchAndStore(authHeader, [activityId], [{ activityId, sportType: activityInfo.type }]);

    const startTime = Date.now();
    const completed = await waitForDownloadCompletion(getDownloadProgress);
    if (!completed) {
      log.warn(`GPS ingest timed out after ${GPS_DOWNLOAD_TIMEOUT_MS}ms for ${activityId}`);
    }

    const result = takeFetchAndStoreResult();
    if (result && result.successCount > 0) {
      const { toActivityMetrics } = require('@/features/activity/lib/activityMetrics');
      routeEngine.setActivityMetrics([toActivityMetrics(activity)]);
      routeEngine.triggerRefresh('activities');
      activityInfo.ingested = true;
      log.log(
        `Activity ingested: ${activityInfo.name} (${result.totalPoints} GPS points, ${Date.now() - startTime}ms)`
      );

      // Detect sections for the new activity so its PRs are present when the
      // notification body queries getSectionsForActivity below.
      try {
        await runSectionDetection(routeEngine);
      } catch (e) {
        log.warn('Section detection after ingest failed:', e);
      }

      // Queue for priority terrain snapshot generation when app opens
      const { addPendingSnapshot } = require('@/features/maps/lib/storage/terrainPreviewCache');
      addPendingSnapshot(activityId).catch(() => {});
    }

    return activityInfo;
  } catch (e) {
    log.warn('Activity fetch/ingest failed:', e);
    return null;
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
 *   2. Fire placeholder notification immediately for activity events (so the
 *      user sees something within ~1s even if enrichment fails)
 *   3. Download GPS, ingest into engine
 *   4. Fetch fresh wellness data from intervals.icu
 *   5. Generate insights (now including the new activity)
 *   6. Replace the placeholder with the enriched body via the same identifier
 */
log.log('Task module loaded, defining task');
TaskManager.defineTask(BACKGROUND_INSIGHT_TASK, async ({ data, error }) => {
  log.log('Task fired (entry)');
  if (error) {
    log.error('Background insight error:', error.message);
    return;
  }

  try {
    // 1. Read preferences directly from AsyncStorage (Zustand may not be hydrated)
    const prefs = await readPrefsFromStorage();
    log.log(`Prefs: enabled=${prefs?.enabled}, hasData=${!!data}`);
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

    // A delivered push proves the pipeline is alive — use it to keep the
    // server-side token registration (30-day TTL) fresh for users who rarely
    // open the app. Throttled to once a day inside the helper.
    try {
      const { getStoredCredentials } = require('@/shared/app/AuthStore');
      const athleteId: string | undefined = getStoredCredentials().athleteId;
      if (athleteId) {
        const {
          refreshPushTokenRegistration,
        } = require('@/features/settings/lib/pushTokenRegistration');
        refreshPushTokenRegistration(athleteId).catch(() => {});
      }
    } catch {
      // Best-effort — never let token upkeep break notification handling.
    }

    // The visible tray push also wakes this task (Expo delivers `notification`
    // messages through the same TaskBroadcastReceiver as `data` messages), but
    // with no event_type/activity_id. Bail immediately — the silent push right
    // behind it carries the real payload.
    if (!eventType) {
      log.log('No event type (visible-push wake), skipping');
      return;
    }

    const isActivityEvent = eventType === 'ACTIVITY_UPLOADED' || eventType === 'ACTIVITY_ANALYZED';

    // 3. Get i18n translation function (standalone, no React)
    const { i18n } = require('@/i18n');
    const t = i18n.t.bind(i18n) as (
      key: string,
      params?: Record<string, string | number>
    ) => string;

    // Note: no on-device placeholder notification — the worker's visible push
    // is already in the tray by the time this task runs. We dismiss that one
    // and present the enriched version below.

    // 5. If activity event, fetch metadata + download GPS into engine
    let activityInfo: ActivityInfo | null = null;
    if (isActivityEvent && activityId) {
      activityInfo = await fetchAndIngestActivity(activityId);
    }

    // 6. Fetch fresh wellness data from intervals.icu API
    let wellnessData: WellnessInput[] | null = null;
    try {
      const { intervalsApi } = require('@/api');
      const wellness = await intervalsApi.getWellness();
      wellnessData = wellness as WellnessInput[];
    } catch (e) {
      log.warn('Could not fetch wellness data:', e);
    }

    // 7. Generate insights (now includes new activity if ingested)
    const enginePayload = fetchInsightsDataFromEngine();
    const insights = enginePayload
      ? computeInsightsFromData(
          enginePayload.insightsData,
          wellnessData,
          t,
          enginePayload.summaryCardData
        )
      : [];

    // 7b. Refresh the home-screen widget — the engine already holds the newly
    // ingested activity, so this is a cheap snapshot write. Lazy-required (deep
    // path, no React components) to keep the headless module graph lean. No-op
    // until the native widget module is built in.
    try {
      const { updateWidgetSnapshot } = require('@/features/home/lib/widgetBridge');
      updateWidgetSnapshot();
    } catch (e) {
      log.warn('widget snapshot update failed:', e);
    }

    // 8. Find insights that are NEW (caused by this activity)
    const storedFingerprint = await AsyncStorage.getItem(FINGERPRINT_KEY);
    const previousIds = new Set((storedFingerprint ?? '').split('|'));
    const newInsights = insights.filter((i) => !previousIds.has(i.id));
    const allowedNewInsights = filterInsightsForNotificationPreferences(newInsights, prefs);

    // 9. Replace the placeholder with the enriched activity notification
    if (isActivityEvent && activityId) {
      const activityName = activityInfo?.name ?? t('notifications.activityRecorded.title');
      const body = buildActivityNotificationBody(
        activityId,
        activityName,
        allowedNewInsights,
        prefs,
        activityInfo,
        t
      );

      // Clear any tray entries for this activity (both the FCM-generated
      // visible push and any older on-device one). We re-present below only
      // if the app is not in foreground — if the user already opened the app
      // via the notification tap, the in-app UI shows the data and leaving
      // a stale tray entry up is noise.
      try {
        const presented = await Notifications.getPresentedNotificationsAsync();
        for (const n of presented) {
          const data = n.request.content.data as { activityId?: string } | undefined;
          const isThisActivity = data?.activityId === activityId;
          const isGenericFcm = !data?.activityId; // FCM-posted visible push
          if (isThisActivity || isGenericFcm) {
            await Notifications.dismissNotificationAsync(n.request.identifier);
          }
        }
      } catch (e) {
        log.warn('Could not dismiss tray entries:', e);
      }

      // Skip re-presenting if the user has already opened the app — they're
      // looking at the data already, a tray entry is redundant. This is the
      // common case when tapping the generic visible push cold-starts the
      // app and the silent push fires the task a second or two later.
      if (AppState.currentState === 'active') {
        log.log('App foregrounded, skipping enriched notification re-post');
      } else {
        await presentActivityNotification(
          activityId,
          t('notifications.activityRecorded.title'),
          body,
          { route: `/activity/${activityId}`, activityId }
        );
        log.log(`Notification sent: ${body}`);
      }
    } else if (allowedNewInsights.length > 0) {
      // Non-activity event (fitness update, wellness change) with new insights.
      // Enforce D11 cooldown — max pushes/week + min spacing — so a flurry of
      // wellness webhooks can't chain-fire notifications.
      const history = await readPushHistory();
      if (!isPushAllowed(history)) {
        log.log(`Push blocked by cooldown (history=${history.length} in last 7d)`);
      } else {
        const bestInsight = pickBestInsightForNotification(allowedNewInsights);
        if (bestInsight) {
          const content = formatInsightNotification(bestInsight, t);
          await presentInsightNotification(content.title, content.body, content.data);
          await appendPushHistory(Date.now());
          log.log(`Notification sent: ${content.title} — ${content.body}`);
        }
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
