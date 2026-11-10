import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { AppState } from 'react-native';

import { debug } from '@/shared/debug/debug';
import { recording } from '@/theme';
import { ensureCredentialsHydrated, useAuthStore } from '@/shared/app/AuthStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import type { AutoPauseDetector } from './autoPause';
import { fixAltitude, getGpsWatchOptions, getAccuracyRejectThreshold } from './gpsConfig';
import { gpsFixKept } from './gpsQuality';
import {
  autoPauseDetector,
  buildAutoPauseDetector,
  evaluateAutoPause,
  setAutoPauseDetector,
} from './manualPause';
import {
  installRecordingNotificationActions,
  locationServiceRunning,
  nameRecordingChannel,
  updateRecordingNotification,
} from './recordingNotification';
import { loadRecordingBackup } from './storage/recordingBackup';
import { writeRideBackup, writeRideBackupIfDue } from './rideBackup';
import { BACKGROUND_LOCATION_TASK } from './backgroundLocationTask';

export { BACKGROUND_LOCATION_TASK } from './backgroundLocationTask';

const log = debug.create('BackgroundLocation');

const SERVICE_CHECK_DELAY_MS = 400;
const SERVICE_CHECK_RETRIES = 6;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The start time of the ride this runtime rehydrated from disk, or null. The
// runtime can outlive the batch that restored it, and a later ride can start in
// it, so the restore lasts only while the store holds that ride. See
// `restoredRideHeld`.
let restoredRideStart: number | null = null;

// The restore in flight. Batches delivered together share it, so none of them
// starts a second restore that could overwrite the ride the first one set.
let restoring: Promise<void> | null = null;

// The detector this runtime built for itself, when no session runs to own one.
let headlessDetector: AutoPauseDetector | null = null;

/**
 * Whether the store still holds the ride this runtime restored. A reset to idle
 * clears the store's start time, and a session that starts later brings its own,
 * so either ends the restore. The detector this runtime built goes with it, and
 * a later ride is persisted and evaluated like any other.
 */
function restoredRideHeld(): boolean {
  if (restoredRideStart === null) return false;
  if (useRecordingStore.getState().startTime === restoredRideStart) return true;
  restoredRideStart = null;
  if (headlessDetector && autoPauseDetector() === headlessDetector) setAutoPauseDetector(null);
  headlessDetector = null;
  return false;
}

/**
 * A headless runtime renders no screen, so no session starts to evaluate
 * auto-pause and the batch has to. A session that starts later owns a detector
 * of its own, seeded from the same state, and this one then stands down.
 */
function batchDrivesAutoPause(): boolean {
  if (!restoredRideHeld()) return false;
  if (!autoPauseDetector()) {
    headlessDetector = buildAutoPauseDetector();
    setAutoPauseDetector(headlessDetector);
  }
  return autoPauseDetector() === headlessDetector;
}

/**
 * Rehydrate a session that only exists on disk. Android can kill the process
 * while the foreground service keeps the location request alive, and the next
 * batch is then delivered by loading the bundle headlessly, where the store is
 * a fresh `idle`. The gap is not credited as paused time for a recording
 * session: the rider was moving, and the fixes in the batch carry their own
 * timestamps. A paused session reopens its pause at the last save, so the gap
 * is credited when it resumes or stops.
 */
async function restoreSessionFromBackup(): Promise<number | null> {
  await ensureCredentialsHydrated();
  const backup = await loadRecordingBackup();
  if (!backup) return null;
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || !backup.athleteId || backup.athleteId !== auth.athleteId)
    return null;
  if (backup.status !== 'recording' && backup.status !== 'paused') return null;

  // Auto-pause reads the rider's preferences, and a fresh runtime has only the
  // defaults until they are loaded.
  const { useRecordingPreferences } = require('../stores/RecordingPreferencesStore');
  if (!useRecordingPreferences.getState().isLoaded) {
    await useRecordingPreferences.getState().initialise();
  }

  // A foreground launch may have started or restored a session during the load.
  if (useRecordingStore.getState().status !== 'idle') return null;

  const { restoreRecordingBackup } = require('./restoreRecordingBackup');
  restoreRecordingBackup(backup, { headless: true });
  // Every batch from here re-posts the notification with its buttons, and no
  // session runs here to listen for them. The hold lasts as long as the
  // runtime does, and a session started later shares it.
  installRecordingNotificationActions();
  log.log('Restored a recording from its backup in a headless runtime');
  return backup.startTime;
}

/**
 * The only writer of `restoredRideStart`. A batch that arrives during a
 * restore awaits that restore. Starting another one would find the store
 * already recording, return null, and overwrite the ride the first one set.
 */
function restoreIfIdle(): Promise<void> {
  if (restoredRideHeld() || useRecordingStore.getState().status !== 'idle') {
    return Promise.resolve();
  }
  if (!restoring) {
    restoring = restoreSessionFromBackup()
      .then((startTime) => {
        restoredRideStart = startTime;
      })
      .finally(() => {
        restoring = null;
      });
  }
  return restoring;
}

export async function handleBackgroundLocations(
  locations: Location.LocationObject[]
): Promise<void> {
  if (!locations || locations.length === 0) return;

  const store = useRecordingStore;
  await restoreIfIdle();

  const { status } = store.getState();
  if (status !== 'recording' && status !== 'paused') return;
  const drivesAutoPause = batchDrivesAutoPause();

  const rejectThreshold = getAccuracyRejectThreshold();
  for (const location of locations) {
    if (!gpsFixKept(location.coords.accuracy, rejectThreshold)) continue;

    const point = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      altitude: fixAltitude(location.coords),
      accuracy: location.coords.accuracy,
      speed: location.coords.speed,
      heading: location.coords.heading,
      timestamp: location.timestamp,
    };
    // Auto-pause needs a speed signal while paused, so raw fixes are published
    // whether or not the point itself is recorded. It can pause or resume the
    // ride mid-batch, so the status is read again for each point.
    store.getState().setRawLocationFix(point);
    if (drivesAutoPause) evaluateAutoPause();
    if (store.getState().status === 'recording') store.getState().addGpsPoint(point);
  }

  // A headless runtime has no screen and no periodic timer, so each batch
  // persists itself or the next kill loses everything since the last one. A
  // live runtime out of the foreground has its timers paused, so its batches
  // persist once an interval of fixes has passed.
  const newestFix = locations.reduce((newest, l) => Math.max(newest, l.timestamp), 0);
  if (restoredRideHeld()) await writeRideBackup(newestFix);
  else if (AppState.currentState !== 'active') await writeRideBackupIfDue(newestFix);

  // The notification is the ride's only surface while the app is backgrounded,
  // and a batch is the only thing that happens out here.
  updateRecordingNotification();

  log.log(`Background: processed ${locations.length} location(s)`);
}

export async function startBackgroundLocation(options?: {
  notificationTitle?: string;
  notificationBody?: string;
}): Promise<void> {
  log.log('Starting background location updates');
  const watch = getGpsWatchOptions();
  nameRecordingChannel();
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: watch.accuracy,
    distanceInterval: watch.distanceInterval,
    timeInterval: watch.timeInterval,
    foregroundService: {
      notificationTitle: options?.notificationTitle ?? 'Recording activity',
      notificationBody: options?.notificationBody ?? 'Veloq is tracking your location',
      notificationColor: recording.light,
    },
    activityType: Location.ActivityType.Fitness,
    showsBackgroundLocationIndicator: true,
  });
}

/**
 * Whether the location foreground service is actually running.
 * `startLocationUpdatesAsync` resolves even when Android refuses it, so the
 * promise says nothing and something else has to answer.
 *
 * Two cheaper answers were tried on a device and both lie, so neither is worth
 * reaching for again. The task registry, `hasStartedLocationUpdatesAsync`,
 * answers whether the task is **registered**, and an abnormally ended ride
 * leaves it registered across a process restart. The service's notification is
 * worse: `manager.notify` takes ownership of the id, so the re-posted one
 * outlives the service and the process both, and was measured still on screen
 * with no app process alive.
 *
 * Android's own list of this app's running services is the one leftovers cannot
 * fake. The registry stays as the fallback for where the module is absent, which
 * is iOS, where nothing refuses the service in the first place.
 */
export async function backgroundLocationRunning(): Promise<boolean> {
  try {
    // The service comes up asynchronously, so absence has to be waited out
    // before it counts as a refusal. A refused start showed no service at all
    // for fifteen seconds, so this separates slow from never with room to spare.
    for (let attempt = 0; attempt <= SERVICE_CHECK_RETRIES; attempt++) {
      const running = await locationServiceRunning();
      if (running == null) break;
      if (running) return true;
      if (attempt < SERVICE_CHECK_RETRIES) await delay(SERVICE_CHECK_DELAY_MS);
    }
    if ((await locationServiceRunning()) != null) return false;
  } catch (e) {
    log.warn('Could not read the running services:', e);
  }
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch (e) {
    log.warn('Could not read the location task state:', e);
    return false;
  }
}

export async function stopBackgroundLocation(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (isRegistered) {
    log.log('Stopping background location updates');
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}
