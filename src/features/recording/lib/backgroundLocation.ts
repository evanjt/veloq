import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';

import { debug } from '@/shared/debug/debug';
import { brand } from '@/theme';
import { getGpsWatchOptions, getAccuracyRejectThreshold } from './gpsConfig';

const log = debug.create('BackgroundLocation');

export const BACKGROUND_LOCATION_TASK = 'veloq-background-location';

// Must be called at module scope (top level, not inside a component)
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    log.error('Background location error:', error.message);
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  // Use require to avoid circular dependency - this runs outside React tree
  const { useRecordingStore } = require('@/features/recording/stores/RecordingStore');
  const { addGpsPoint, status } = useRecordingStore.getState();

  if (status !== 'recording') return;

  const rejectThreshold = getAccuracyRejectThreshold();
  for (const location of locations) {
    // Drop low-accuracy points to reduce GPS noise (threshold is a preference)
    if (location.coords.accuracy != null && location.coords.accuracy > rejectThreshold) continue;

    addGpsPoint({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      altitude: location.coords.altitude,
      accuracy: location.coords.accuracy,
      speed: location.coords.speed,
      heading: location.coords.heading,
      timestamp: location.timestamp,
    });
  }

  log.log(`Background: processed ${locations.length} location(s)`);
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

export async function stopBackgroundLocation(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (isRegistered) {
    log.log('Stopping background location updates');
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}
