import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { getSetting } from '@/shared/storage';
import { debug } from '@/shared/debug/debug';
import { sourceFor } from '@/shared/app/source';
import {
  presentActivityNotification,
  refreshPushTokenRegistration,
  type NotificationPreferences,
} from '@/features/settings/light';

import { pushNotificationTemplates } from '@/i18n/notificationTemplates';
import type { ActivityInfo } from './lib/activityHighlight';
import { extractPushPayload } from './lib/pushPayload';
import { replaceActivityTrayEntry, trayActionFor } from './lib/traySweep';
import { appendTaskRun } from './lib/taskRunLog';
import { BACKGROUND_INSIGHT_TASK } from './backgroundInsightRegistration';

export { BACKGROUND_INSIGHT_TASK } from './backgroundInsightRegistration';
const log = debug.create('BackgroundInsight');

const PREFS_KEY = 'veloq-notification-preferences';

/** Max time to wait for the engine to store the activity's detail body. */
const ACTIVITY_DETAIL_TIMEOUT_MS = 15_000;

/**
 * Max time to wait for the engine to fetch the activity's remaining bodies,
 * the budget the narrow track download had before the streams replaced it.
 */
const ACTIVITY_READY_TIMEOUT_MS = 15_000;

/**
 * Read notification preferences through the settings reader, so an open
 * engine answers from SQLite and a headless start falls back to the mirror.
 * In background context, Zustand store may not be initialised.
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
      regroupScheduled: boolean;
    } | null;
    await appendTaskRun({
      stage: 'indexed',
      activityId,
      detail: summary
        ? `${summary.matchedSections} sections, ${summary.insertedPortions} portions, regroupScheduled=${summary.regroupScheduled}, ${Date.now() - start}ms`
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
 * Fetch what the activity still lacks for a screen that opens with no network,
 * its detail streams, intervals and track, and record the outcome.
 *
 * A platform whose push handler stores only the detail and the narrow track
 * leaves the rest owed, and without this the athlete who taps the entry with
 * no signal opens a screen whose charts wait on the network. The engine owns
 * what is owed and answers at once when nothing is, so this runs on every
 * platform. The fetch carries on in the engine past the deadline, and only the
 * task stops waiting for it.
 */
async function readyActivity(activityId: string): Promise<void> {
  const start = Date.now();
  let detail: string;
  try {
    const { engine } = require('veloqrs') as typeof import('veloqrs');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ACTIVITY_READY_TIMEOUT_MS);
    });
    const ready = await Promise.race([engine.readyActivityBodies(activityId), deadline]);
    clearTimeout(timer);
    const elapsed = `${Date.now() - start}ms`;
    detail =
      ready === null
        ? `timed out after ${elapsed}`
        : ready
          ? `ready in ${elapsed}`
          : `still owed after ${elapsed}`;
  } catch (e) {
    log.warn('Readying the activity failed:', e);
    detail = `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  await appendTaskRun({ stage: 'readied', activityId, detail });
}

/**
 * Fetch the activity's detail and ready the rest of its bodies in the engine.
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
    // `initialise()` and the credential is null however signed in the athlete
    // is. Read it from SecureStore before the guard, or every cold push bails
    // here and no rung below it ever runs.
    await ensureCredentialsHydrated();
    if (getStoredCredentials().athleteId !== expectedAthleteId) return null;

    // A headless start may reach the engine before the layout init effect has,
    // so hand it the rehydrated credential before asking it to fetch.
    pushCredentialsToEngine();

    const { engine } = require('veloqrs');
    const { awaitActivityBody } =
      require('./lib/awaitActivityBody') as typeof import('./lib/awaitActivityBody');

    const activity = await awaitActivityBody(engine, activityId, ACTIVITY_DETAIL_TIMEOUT_MS);
    if (!activity) return null;
    if (getStoredCredentials().athleteId !== expectedAthleteId) return null;

    const activityInfo: ActivityInfo = {
      name: activity.name ?? 'Activity',
      type: activity.sportType ?? 'Ride',
      ingested: false,
    };

    // The detail is stored, so the engine knows what else the activity lacks.
    // A push the platform handler already readied owes nothing and costs one
    // read; otherwise the streams carry the track, and the intervals come with
    // them, so the athlete who taps the entry offline opens the whole screen.
    await readyActivity(activityId);

    activityInfo.ingested = (() => {
      try {
        return engine.hasActivity(activityId);
      } catch {
        return false;
      }
    })();
    if (activityInfo.ingested) {
      engine.triggerRefresh('activities');
      log.log(`Activity ingested: ${activityInfo.name}`);
      // Idempotent, and covers a webhook that arrived before indexing ran, so
      // the activity's PRs are present when the notification body is built.
      await indexActivity(engine, activityId);
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
 *   3. Fetch the detail, then ready the streams, track and intervals
 *   4. Fetch fresh wellness data from intervals.icu
 *   5. Generate insights (now including the new activity)
 *   6. Replace the placeholder with the enriched body via the same identifier
 */
export async function handleBackgroundInsightTask({
  data,
  error,
}: TaskManager.TaskManagerTaskBody): Promise<void> {
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

    // 5. If activity event, fetch the detail and ready the activity's bodies
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
      // that may never have been through `initialiseApp`, and this is the last
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
      if (athleteId && sourceFor({ authMethod })?.can.push) {
        await refreshPushTokenRegistration(athleteId);
      }
    } catch {
      // Best-effort. Never let token upkeep break notification handling.
    }
  } catch (e) {
    log.error('Background insight task failed:', e);
    await appendTaskRun({ stage: 'error', detail: e instanceof Error ? e.message : String(e) });
  }
}

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
