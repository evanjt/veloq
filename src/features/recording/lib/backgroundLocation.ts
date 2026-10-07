import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';

import { debug } from '@/shared/debug/debug';
import { brand } from '@/theme';
import type { AutoPauseDetector } from './autoPause';
import { fixAltitude, getGpsWatchOptions, getAccuracyRejectThreshold } from './gpsConfig';
import { locationServiceRunning, updateRecordingNotification } from './recordingNotification';
import {
  buildRecordingBackup,
  loadRecordingBackup,
  saveRecordingBackup,
} from './storage/recordingBackup';

const log = debug.create('BackgroundLocation');

export const BACKGROUND_LOCATION_TASK = 'veloq-background-location';

const SERVICE_CHECK_DELAY_MS = 400;
const SERVICE_CHECK_RETRIES = 6;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// True once this runtime has rehydrated a session from disk. A headless
// runtime is torn down with the batch, so the flag is only ever set for the
// batches that follow the restoring one inside the same runtime.
let restoredFromBackup = false;

// The detector this runtime built for itself, when no session runs to own one.
let headlessDetector: AutoPauseDetector | null = null;

// Use require to avoid a circular dependency - this runs outside the React tree
function recordingStore() {
  return require('@/features/recording/stores/RecordingStore').useRecordingStore;
}

function autoPause(): typeof import('./manualPause') {
  return require('./manualPause');
}

/**
 * A headless runtime renders no screen, so no session starts to evaluate
 * auto-pause and the batch has to. A session that starts later owns a detector
 * of its own, seeded from the same state, and this one then stands down.
 */
function batchDrivesAutoPause(): boolean {
  if (!restoredFromBackup) return false;
  const pause = autoPause();
  if (!pause.autoPauseDetector()) {
    headlessDetector = pause.buildAutoPauseDetector();
    pause.setAutoPauseDetector(headlessDetector);
  }
  return pause.autoPauseDetector() === headlessDetector;
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
async function restoreSessionFromBackup(): Promise<boolean> {
  const { ensureCredentialsHydrated } = require('@/shared/app/AuthStore');
  await ensureCredentialsHydrated();
  const backup = await loadRecordingBackup();
  if (!backup) return false;
  const { useAuthStore } = require('@/shared/app/AuthStore');
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || !backup.athleteId || backup.athleteId !== auth.athleteId)
    return false;
  if (backup.status !== 'recording' && backup.status !== 'paused') return false;

  // Auto-pause reads the rider's preferences, and a fresh runtime has only the
  // defaults until they are loaded.
  const { useRecordingPreferences } = require('../stores/RecordingPreferencesStore');
  if (!useRecordingPreferences.getState().isLoaded) {
    await useRecordingPreferences.getState().initialize();
  }

  // A foreground launch may have started or restored a session during the load.
  if (recordingStore().getState().status !== 'idle') return false;

  const { restoreRecordingBackup } = require('./restoreRecordingBackup');
  restoreRecordingBackup(backup, { headless: true });
  log.log('Restored a recording from its backup in a headless runtime');
  return true;
}

export async function handleBackgroundLocations(
  locations: Location.LocationObject[]
): Promise<void> {
  if (!locations || locations.length === 0) return;

  const store = recordingStore();
  if (store.getState().status === 'idle' && !restoredFromBackup) {
    restoredFromBackup = await restoreSessionFromBackup();
  }

  const { status } = store.getState();
  if (status !== 'recording' && status !== 'paused') return;
  const drivesAutoPause = batchDrivesAutoPause();

  const rejectThreshold = getAccuracyRejectThreshold();
  for (const location of locations) {
    // Drop low-accuracy points to reduce GPS noise (threshold is a preference)
    if (location.coords.accuracy != null && location.coords.accuracy > rejectThreshold) continue;

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
    if (drivesAutoPause) autoPause().evaluateAutoPause();
    if (store.getState().status === 'recording') store.getState().addGpsPoint(point);
  }

  // A headless runtime has no screen and no periodic timer, so each batch
  // persists itself or the next kill loses everything since the last one.
  if (restoredFromBackup) {
    const { useRecordingLiveStore } = require('../stores/RecordingLiveStore');
    const backup = buildRecordingBackup({
      ...store.getState(),
      autoPaused: useRecordingLiveStore.getState().autoPaused,
    });
    if (backup) await saveRecordingBackup(backup);
  }

  // The notification is the ride's only surface while the app is backgrounded,
  // and a batch is the only thing that happens out here.
  updateRecordingNotification();

  log.log(`Background: processed ${locations.length} location(s)`);
}

// Must be called at module scope (top level, not inside a component)
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    log.error('Background location error:', error.message);
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  await handleBackgroundLocations(locations);
});

export async function startBackgroundLocation(options?: {
  notificationTitle?: string;
  notificationBody?: string;
}): Promise<void> {
  log.log('Starting background location updates');
  const watch = getGpsWatchOptions();
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: watch.accuracy,
    distanceInterval: watch.distanceInterval,
    timeInterval: watch.timeInterval,
    foregroundService: {
      notificationTitle: options?.notificationTitle ?? 'Recording activity',
      notificationBody: options?.notificationBody ?? 'Veloq is tracking your location',
      notificationColor: brand.tealLight,
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
