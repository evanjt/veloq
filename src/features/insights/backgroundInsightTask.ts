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
import { extractPushPayload } from './lib/pushPayload';
import { appendTaskRun } from './lib/taskRunLog';
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
 * Attach a freshly ingested activity to existing sections and route groups so
 * its PRs are available when buildActivityNotificationBody queries the engine.
 * Cheap (one activity vs existing sections, incremental regroup) so it fits
 * the background push budget where a full O(N²) detection cannot. New sections
 * the activity might create wait for the next full detection run.
 */
async function indexActivity(
  routeEngine: { indexNewActivity: (activityId: string) => unknown },
  activityId: string
): Promise<void> {
  const start = Date.now();
  try {
    const summary = routeEngine.indexNewActivity(activityId) as {
      matchedSections: number;
      insertedPortions: number;
      regrouped: boolean;
    } | null;
    await appendTaskRun({
      stage: 'indexed',
      activityId,
      detail: summary
        ? `${summary.matchedSections} sections, ${summary.insertedPortions} portions, regrouped=${summary.regrouped}, ${Date.now() - start}ms`
        : 'indexing failed',
    });
  } catch (e) {
    log.warn('Activity indexing failed:', e);
    await appendTaskRun({
      stage: 'indexed',
      activityId,
      detail: `failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
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

    // Skip GPS download if we already have this activity in SQLite - the
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
      // Idempotent, and covers a webhook that arrived before indexing ran.
      await indexActivity(routeEngine, activityId);
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

      // Attach the new activity to existing sections and route groups so its
      // PRs are present when the notification body queries the engine below.
      await indexActivity(routeEngine, activityId);

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
 * Runs outside React - no hooks, no providers, no context.
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
    await appendTaskRun({ stage: 'fired' });

    // 1. Read preferences directly from AsyncStorage (Zustand may not be hydrated)
    const prefs = await readPrefsFromStorage();
    log.log(`Prefs: enabled=${prefs?.enabled}, hasData=${!!data}`);
    if (!prefs?.enabled) {
      log.log('Notifications disabled, skipping');
      await appendTaskRun({ stage: 'bailed', detail: 'notifications disabled' });
      return;
    }

    // 2. Extract push payload. The delivered shape varies by platform, so the
    // extractor tries every known wrapping (dataString, body, flat, nested).
    const payload = extractPushPayload(data);
    const { eventType, activityId, sourceShape } = payload;

    log.log(`Push received: event=${eventType}, activity=${activityId}, shape=${sourceShape}`);

    // The visible tray push also wakes this task (Expo delivers `notification`
    // messages through the same TaskBroadcastReceiver as `data` messages), but
    // with no event_type/activity_id. Bail immediately - the silent push right
    // behind it carries the real payload.
    if (!eventType) {
      log.log('No event type (visible-push wake), skipping');
      await appendTaskRun({
        stage: 'bailed',
        sourceShape,
        detail: `no event type; keys=[${payload.rawKeys.join(',')}]`,
      });
      return;
    }
    await appendTaskRun({ stage: 'parsed', eventType, activityId, sourceShape });

    const isActivityEvent = eventType === 'ACTIVITY_UPLOADED' || eventType === 'ACTIVITY_ANALYZED';

    // 3. Get i18n translation function (standalone, no React)
    const { i18n } = require('@/i18n');
    const t = i18n.t.bind(i18n) as (
      key: string,
      params?: Record<string, string | number>
    ) => string;

    // Note: no on-device placeholder notification - the worker's visible push
    // is already in the tray by the time this task runs. We dismiss that one
    // and present the enriched version below.

    // 5. If activity event, fetch metadata + download GPS into engine
    let activityInfo: ActivityInfo | null = null;
    if (isActivityEvent && activityId) {
      const ingestStart = Date.now();
      activityInfo = await fetchAndIngestActivity(activityId);
      await appendTaskRun({
        stage: 'ingested',
        eventType,
        activityId,
        detail: activityInfo
          ? `${activityInfo.ingested ? 'ingested' : 'metadata only'} in ${Date.now() - ingestStart}ms`
          : 'fetch failed',
      });
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

    // 7b. Refresh the home-screen widget - the engine already holds the newly
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
      // if the app is not in foreground - if the user already opened the app
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

      // Skip re-presenting if the user has already opened the app - they're
      // looking at the data already, a tray entry is redundant. This is the
      // common case when tapping the generic visible push cold-starts the
      // app and the silent push fires the task a second or two later.
      if (AppState.currentState === 'active') {
        log.log('App foregrounded, skipping enriched notification re-post');
        await appendTaskRun({ stage: 'notified', activityId, detail: 'skipped (foreground)' });
      } else {
        await presentActivityNotification(
          activityId,
          t('notifications.activityRecorded.title'),
          body,
          { route: `/activity/${activityId}`, activityId }
        );
        log.log(`Notification sent: ${body}`);
        await appendTaskRun({ stage: 'notified', activityId, detail: body });
      }
    } else if (allowedNewInsights.length > 0) {
      // Non-activity event (fitness update, wellness change) with new insights.
      // Enforce D11 cooldown - max pushes/week + min spacing - so a flurry of
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
          log.log(`Notification sent: ${content.title} - ${content.body}`);
        }
      }
    } else {
      log.log('No notification content to show');
    }

    // 9b. Kick a full section detection for anything cheap indexing can't do
    // (genuinely new sections). Fire-and-forget: no polling, the foreground
    // drain picks up the completed run on next app open.
    if (isActivityEvent && activityInfo?.ingested) {
      try {
        const { routeEngine } = require('veloqrs');
        routeEngine.startSectionDetection();
      } catch {
        // Best-effort.
      }
    }

    // 9. Update stored fingerprint
    const currentFingerprint = insights.length > 0 ? computeInsightFingerprint(insights) : '';
    if (currentFingerprint) {
      await AsyncStorage.setItem(FINGERPRINT_KEY, currentFingerprint);
    }

    // 10. A delivered push proves the pipeline is alive, so use it to keep
    // the server-side token registration (30-day TTL) fresh for users who
    // rarely open the app. Runs last: by now the auth store has rehydrated
    // (a cold headless start reads athleteId as null until then). Throttled
    // to once a day inside the helper.
    try {
      const { getStoredCredentials } = require('@/shared/app/AuthStore');
      const athleteId: string | null = getStoredCredentials().athleteId;
      if (athleteId) {
        const {
          refreshPushTokenRegistration,
        } = require('@/features/settings/lib/pushTokenRegistration');
        await refreshPushTokenRegistration(athleteId);
      }
    } catch {
      // Best-effort. Never let token upkeep break notification handling.
    }
  } catch (e) {
    log.error('Background insight task failed:', e);
    await appendTaskRun({ stage: 'error', detail: e instanceof Error ? e.message : String(e) });
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
