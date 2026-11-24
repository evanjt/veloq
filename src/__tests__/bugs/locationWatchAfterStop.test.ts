/**
 * Scenario: the rider stops the ride while the location watch is still waiting on the permission
 * check that arms it.
 *
 * Expected behaviour: nothing is started once the session has stopped. The check used to be read
 * once on entry, so the late arrival started the foreground service and its supervisor for a ride
 * that no longer existed, and nothing was left to stop them.
 */

import { AppState } from 'react-native';
import * as Location from 'expo-location';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  nameRecordingChannel: jest.fn(),
  installRecordingNotificationActions: jest.fn(() => jest.fn()),
  updateRecordingNotification: jest.fn(),
  clearRecordingNotification: jest.fn(),
}));

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  buildRecordingBackup: jest.fn(() => ({ startTime: 1 })),
  saveRecordingBackup: jest.fn(),
  clearRecordingBackup: jest.fn(),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
}));

jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

const permission = Location.getForegroundPermissionsAsync as jest.Mock;
const startService = Location.startLocationUpdatesAsync as jest.Mock;

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('arming the location watch for a stopped session', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({
      remove: jest.fn(),
    })) as never);
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    useRecordingStore.getState().reset();
    useRecordingLiveStore.getState().reset();
    uninstall = installRecordingSession();
  });

  afterEach(() => {
    uninstall?.();
    useRecordingStore.getState().reset();
    jest.restoreAllMocks();
  });

  it('starts no service when the ride ends before the permission check answers', async () => {
    let answer: (value: { status: string }) => void = () => undefined;
    permission.mockImplementationOnce(
      () => new Promise<{ status: string }>((resolve) => (answer = resolve))
    );

    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    useRecordingStore.getState().reset();
    answer({ status: 'granted' });
    await settle();

    expect(startService).not.toHaveBeenCalled();
  });
});
