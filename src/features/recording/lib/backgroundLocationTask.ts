import * as TaskManager from 'expo-task-manager';
import type * as Location from 'expo-location';

import { debug } from '@/shared/debug/debug';

export const BACKGROUND_LOCATION_TASK = 'veloq-background-location';
const log = debug.create('BackgroundLocation');

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    log.error('Background location error:', error.message);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest and Metro load the handler only when the task fires.
  const task = require('./backgroundLocation') as typeof import('./backgroundLocation');
  const { locations } = data as { locations: Location.LocationObject[] };
  await task.handleBackgroundLocations(locations);
});
