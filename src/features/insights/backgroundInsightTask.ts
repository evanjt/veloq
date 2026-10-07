import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { getSetting } from '@/shared/storage';
import { debug } from '@/shared/debug/debug';
import { presentActivityNotification } from '@/features/settings/lib/notificationService';
import type { NotificationPreferences } from '@/features/settings';

import { pushNotificationTemplates } from '@/i18n/notificationTemplates';
import type { ActivityInfo } from './lib/activityHighlight';
import { activityStartEpoch } from '@/shared/activity/streamWindow';
import { extractPushPayload } from './lib/pushPayload';
import { replaceActivityTrayEntry, trayActionFor } from './lib/traySweep';
import { appendTaskRun } from './lib/taskRunLog';
import { awaitActivityBody } from './lib/awaitActivityBody';
const log = debug.create('BackgroundInsight');

export const BACKGROUND_INSIGHT_TASK = 'veloq-background-insight';

const PREFS_KEY = 'veloq-notification-preferences';

/** Max time to wait for GPS download (15 seconds) */
const GPS_DOWNLOAD_TIMEOUT_MS = 15_000;
const GPS_DOWNLOAD_POLL_MS = 250;

/** Max time to wait for the engine to store the activity's detail body. */
const ACTIVITY_DETAIL_TIMEOUT_MS = 15_000;

/**
 * Read notification preferences through the settings reader, so an open
 * engine answers from SQLite and a headless start falls back to the mirror.
 * In background context, Zustand store may not be initialized.
 */
async function readPrefsFromStorage(): Promise<NotificationPreferences | null> {
  try {
    const raw = await getSetting(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NotificationPreferences;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for one run's own result.
 *
 * This used to poll `getDownloadProgress().active`, which is a single global
 * flag: with a foreground sync running, the push task could watch that sync's
 * download finish, return, and take a result that was never its own. A run's
 * result appears only when that run finishes, so waiting on it is the same
 * wait without the mistake.
 */
interface FetchRunResult {
  successCount: number;
  totalPoints: number;
}

async function waitForRunResult(
  takeResult: (run: number) => FetchRunResult | null | undefined,
  run: number
): Promise<FetchRunResult | null> {
  const deadline = Date.now() + GPS_DOWNLOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = takeResult(run);
    if (result) return result;
    await sleep(GPS_DOWNLOAD_POLL_MS);
  }
  return null;
}

/**
 * Attach a freshly ingested activity to existing sections and route groups so
 * its PRs are available when the engine is asked what the activity was worth.
 * Cheap (one activity vs existing sections, incremental regroup) so it fits
 * the background push budget where a full O(N²) detection cannot. New sections
 * the activity might create wait for the next full detection run.
 */
async function indexActivity(
  engine: { indexNewActivity: (activityId: string) => unknown },
  activityId: string
): Promise<void> {
  const start = Date.now();
  try {
    const summary = engine.indexNewActivity(activityId) as {
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
async function fetchAndIngestActivity(
  activityId: string,
  expectedAthleteId: string
): Promise<ActivityInfo | null> {
  try {
    const {
      ensureCredentialsHydrated,
      getStoredCredentials,
      pushCredentialsToEngine,
    } = require('@/shared/app/AuthStore');

    // A headless start mounts no React tree, so nothing has called
    // `initialize()` and the credential is null however signed in the athlete
    // is. Read it from SecureStore before the guard, or every cold push bails
    // here and no rung below it ever runs.
    await ensureCredentialsHydrated();
    if (getStoredCredentials().athleteId !== expectedAthleteId) return null;

    // A headless start may reach the engine before the layout init effect has,
    // so hand it the rehydrated credential before asking it to fetch.
    pushCredentialsToEngine();

    const { engine } = require('veloqrs');
    const { DownloadPriority } = require('veloqrs') as typeof import('veloqrs');

    const activity = await awaitActivityBody(engine, activityId, ACTIVITY_DETAIL_TIMEOUT_MS);
    if (!activity) return null;
    if (getStoredCredentials().athleteId !== expectedAthleteId) return null;

    const activityInfo: ActivityInfo = {
      name: typeof activity.name === 'string' ? activity.name : 'Activity',
      type: typeof activity.type === 'string' ? activity.type : 'Ride',
      ingested: false,
    };

    // Skip GPS download if we already have this activity in SQLite - the
    // enrichment path reads sections from the DB, so a re-delivered webhook
    // (or duplicate silent push) produces the same enriched output without
    // a pointless 150–15000ms network roundtrip.
    const alreadyIngested = (() => {
      try {
        return engine.hasActivity(activityId);
      } catch {
        return false;
      }
    })();

    if (alreadyIngested) {
      activityInfo.ingested = true;
      log.log(`Activity already in DB, skipping download: ${activityInfo.name}`);
      // Idempotent, and covers a webhook that arrived before indexing ran.
      await indexActivity(engine, activityId);
      return activityInfo;
    }

    const startDate = activityStartEpoch(
      typeof activity.start_date_local === 'string' ? activity.start_date_local : undefined
    );
    const run = engine.startFetchAndStore(
      [activityId],
      [
        {
          activityId,
          sportType: activityInfo.type,
          ...(startDate !== undefined && { startDate }),
        },
      ],
      // One activity a notification is waiting on, so it takes the lane that
      // does not queue behind a foreground bulk pass.
      DownloadPriority.Interactive
    );

    const startTime = Date.now();
    const result = await waitForRunResult((r: number) => engine.takeFetchAndStoreResult(r), run);
    if (!result) {
      log.warn(`GPS ingest timed out after ${GPS_DOWNLOAD_TIMEOUT_MS}ms for ${activityId}`);
    }
    if (result && result.successCount > 0) {
      engine.triggerRefresh('activities');
      activityInfo.ingested = true;
      log.log(
        `Activity ingested: ${activityInfo.name} (${result.totalPoints} GPS points, ${Date.now() - startTime}ms)`
      );

      // Attach the new activity to existing sections and route groups so its
      // PRs are present when the notification body queries the engine below.
      await indexActivity(engine, activityId);

      // Only mounts the snapshot pool early on next open; it changes no order
      const { addPendingSnapshot } = require('@/features/maps') as typeof import('@/features/maps');
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

    // 1. Read preferences through getSetting (Zustand may not be hydrated)
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

    if (eventType) {
      const { ensureCredentialsHydrated, getStoredCredentials } = require('@/shared/app/AuthStore');
      await ensureCredentialsHydrated();
      if (!payload.athleteId || payload.athleteId !== getStoredCredentials().athleteId) {
        await appendTaskRun({ stage: 'bailed', detail: 'push athlete not signed in' });
        return;
      }
    }

    log.log(`Push received: event=${eventType}, activity=${activityId}, shape=${sourceShape}`);

    // A wake with no event type. The visible tray push carries none, and it
    // reaches this task only while the app is in the foreground: backgrounded,
    // the Firebase SDK renders a `notification` message itself and expo's
    // delegate hands it to no listener, so nothing here runs. Whichever it was,
    // the silent push right behind it carries the real payload, so bail.
    if (!eventType) {
      log.log('No event type, skipping');
      await appendTaskRun({
        stage: 'bailed',
        sourceShape,
        detail: `no event type; keys=[${payload.rawKeys.join(',')}]`,
      });
      return;
    }
    await appendTaskRun({ stage: 'parsed', eventType, activityId, sourceShape });

    const isActivityEvent = eventType === 'ACTIVITY_UPLOADED' || eventType === 'ACTIVITY_ANALYZED';
    const pushAthleteId = payload.athleteId;

    // Note: no on-device placeholder notification - the worker's visible push
    // is already in the tray by the time this task runs. We dismiss that one
    // and present the enriched version below.

    // 5. If activity event, fetch metadata + download GPS into engine
    let activityInfo: ActivityInfo | null = null;
    if (isActivityEvent && activityId && pushAthleteId) {
      const ingestStart = Date.now();
      activityInfo = await fetchAndIngestActivity(activityId, pushAthleteId);
      const { getStoredCredentials } = require('@/shared/app/AuthStore');
      if (getStoredCredentials().athleteId !== pushAthleteId) {
        await appendTaskRun({ stage: 'bailed', detail: 'signed-in athlete changed' });
        return;
      }
      await appendTaskRun({
        stage: 'ingested',
        eventType,
        activityId,
        detail: activityInfo
          ? `${activityInfo.ingested ? 'ingested' : 'metadata only'} in ${Date.now() - ingestStart}ms`
          : 'fetch failed',
      });
    }

    // 7b. Refresh the home-screen widget - the engine already holds the newly
    // ingested activity, so this is a cheap snapshot write. Lazy-required (deep
    // path, no React components) to keep the headless module graph lean. No-op
    // until the native widget module is built in.
    try {
      const { updateWidgetSnapshot } =
        require('@/features/home') as typeof import('@/features/home');
      updateWidgetSnapshot();
    } catch (e) {
      log.warn('widget snapshot update failed:', e);
    }

    // 9. Replace the placeholder with the enriched activity notification.
    // On iOS the notification service extension is the only poster for an
    // activity push, so the task ingests and refreshes but leaves the tray alone.
    if (isActivityEvent && activityId && Platform.OS === 'ios') {
      log.log('Activity push on iOS, tray left to the notification extension');
      await appendTaskRun({ stage: 'notified', activityId, detail: 'skipped (extension posts)' });
    } else if (isActivityEvent && activityId) {
      // An ingest that failed has no name, and an empty body is how that
      // reaches the tray decision below rather than as the notification's own
      // title repeated back to the athlete.
      // The ladder and the templates are the engine's, so the sentence a
      // native handler builds and the one this builds are the same sentence.
      // The templates are pushed here too: the headless task runs in a process
      // that may never have been through `initializeApp`, and this is the last
      // point that still has i18next to resolve one.
      pushNotificationTemplates();
      // Lazily required like every other engine reach in this file, to keep
      // the headless module graph lean.
      const { engine } = require('veloqrs') as typeof import('veloqrs');
      // The engine finds a fitness milestone itself, so the switch is all it
      // is told.
      const { title, body } = engine.activityNotification(
        activityId,
        activityInfo?.name ?? '',
        prefs.categories.sectionPr,
        prefs.categories.fitnessMilestone
      ) ?? { title: '', body: '' };

      // The enriched entry goes up, then the entries it replaces come down.
      // Nothing is posted when the app is already open: the athlete is on the
      // activity and a tray entry is noise, which is the common case when
      // tapping the visible push cold-starts the app and the silent push fires
      // the task a second later. The old entries still come down.
      const action = trayActionFor(
        Platform.OS,
        body,
        AppState.currentState === 'active',
        activityInfo?.ingested ?? false
      );
      const posted =
        action === 'leave'
          ? false
          : await replaceActivityTrayEntry({
              activityId,
              listPresented: async () =>
                (await Notifications.getPresentedNotificationsAsync()).map((n) => ({
                  identifier: n.request.identifier,
                  data: n.request.content.data,
                })),
              dismiss: (identifier) => Notifications.dismissNotificationAsync(identifier),
              present:
                action === 'dismiss-only'
                  ? null
                  : () =>
                      presentActivityNotification(activityId, title, body, {
                        route: `/activity/${activityId}`,
                        activityId,
                      }),
            });

      if (posted) {
        log.log(`Notification sent: ${body}`);
        await appendTaskRun({ stage: 'notified', activityId, detail: body });
      } else if (action === 'leave') {
        log.warn('Nothing to say about this activity, leaving the tray as it is');
        await appendTaskRun({ stage: 'notified', activityId, detail: 'skipped (no detail)' });
      } else if (action === 'dismiss-only') {
        log.log('App foregrounded, skipping enriched notification re-post');
        await appendTaskRun({ stage: 'notified', activityId, detail: 'skipped (foreground)' });
      } else {
        log.warn('Enriched notification could not be posted, tray left as it was');
        await appendTaskRun({ stage: 'notified', activityId, detail: 'post failed' });
      }
    } else {
      // Fitness and wellness updates sync silently. Their insights wait for
      // the next time the app opens.
      log.log('No activity behind this push, nothing to post');
    }

    // 9b. The engine starts a detection run itself when the stored batch
    // lands; the foreground drain picks up the completed run on next open.

    // 10. A delivered push proves the pipeline is alive, so use it to keep
    // the server-side token registration (30-day TTL) fresh for users who
    // rarely open the app. Throttled to once a day inside the helper. A wake
    // carrying no activity reaches here without the ingest above, so it asks
    // for the credential itself rather than assuming that ran.
    try {
      const { ensureCredentialsHydrated, getStoredCredentials } = require('@/shared/app/AuthStore');
      await ensureCredentialsHydrated();
      const { athleteId, authMethod } = getStoredCredentials();
      if (athleteId && authMethod === 'oauth') {
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
