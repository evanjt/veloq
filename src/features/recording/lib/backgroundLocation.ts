import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';

import { debug } from '@/shared/debug/debug';
import { brand } from '@/theme';
import { getGpsWatchOptions, getAccuracyRejectThreshold } from './gpsConfig';
import { updateRecordingNotification } from './recordingNotification';
import {
  buildRecordingBackup,
  loadRecordingBackup,
  saveRecordingBackup,
} from './storage/recordingBackup';

const log = debug.create('BackgroundLocation');

export const BACKGROUND_LOCATION_TASK = 'veloq-background-location';

// True once this runtime has rehydrated a session from disk. A headless
// runtime is torn down with the batch, so the flag is only ever set for the
// batches that follow the restoring one inside the same runtime.
let restoredFromBackup = false;

// Use require to avoid a circular dependency - this runs outside the React tree
function recordingStore() {
  return require('@/features/recording/stores/RecordingStore').useRecordingStore;
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
  const backup = await loadRecordingBackup();
  if (!backup) return false;
  if (backup.status !== 'recording' && backup.status !== 'paused') return false;

  const store = recordingStore();
  store
    .getState()
    .startRecording(backup.activityType, backup.mode, backup.pairedEventId ?? undefined);
  store.setState({
    status: backup.status,
    startTime: backup.startTime,
    pausedDuration: backup.pausedDuration,
    pauseIntervals: backup.pauseIntervals ?? [],
    streams: backup.streams,
    laps: backup.laps,
    _pauseStart: backup.status === 'paused' ? backup.savedAt : null,
  });
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

  const { addGpsPoint, setRawLocationFix, status } = store.getState();
  if (status !== 'recording' && status !== 'paused') return;

  const rejectThreshold = getAccuracyRejectThreshold();
  for (const location of locations) {
    // Drop low-accuracy points to reduce GPS noise (threshold is a preference)
    if (location.coords.accuracy != null && location.coords.accuracy > rejectThreshold) continue;

    const point = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      altitude: location.coords.altitude,
      accuracy: location.coords.accuracy,
      speed: location.coords.speed,
      heading: location.coords.heading,
      timestamp: location.timestamp,
    };
    // Auto-pause needs a speed signal while paused, so raw fixes are published
    // whether or not the point itself is recorded.
    setRawLocationFix(point);
    if (status === 'recording') addGpsPoint(point);
  }

  // A headless runtime has no screen and no periodic timer, so each batch
  // persists itself or the next kill loses everything since the last one.
  if (restoredFromBackup) {
    const backup = buildRecordingBackup(store.getState());
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
 * Whether the location task is actually running. `startLocationUpdatesAsync`
 * resolves even when Android refuses the foreground service, so this is the only
 * thing that separates a service that started from one that did not.
 */
export async function backgroundLocationRunning(): Promise<boolean> {
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
