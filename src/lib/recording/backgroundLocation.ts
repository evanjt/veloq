import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { debug } from '@/lib';

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

  // Use require to avoid circular dependency — this runs outside React tree
  const { useRecordingStore } = require('@/providers/RecordingStore');
  const { addGpsPoint, status } = useRecordingStore.getState();

  if (status !== 'recording') return;

  for (const location of locations) {
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

export async function startBackgroundLocation(): Promise<void> {
  log.log('Starting background location updates');
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 5,
    timeInterval: 1000,
    foregroundService: {
      notificationTitle: 'Recording activity',
      notificationBody: 'Veloq is tracking your location',
      notificationColor: '#FC4C02',
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
