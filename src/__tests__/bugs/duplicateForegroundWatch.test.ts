/**
 * Scenario: the session and the screen effect both arm the location watch on
 * the same status change, and each awaits the permission check first.
 *
 * Expected behaviour: one watch. The `if (watch) return` guard is read before
 * either await resolves, so both calls used to pass it and the second
 * subscription was never held and never removed, leaving a foreground GPS
 * watch running for the life of the process.
 */

import { AppState } from 'react-native';
import * as Location from 'expo-location';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import {
  ensureLocationWatch,
  installRecordingSession,
} from '@/features/recording/lib/recordingSession';

jest.mock('@/features/recording/lib/recordingNotification', () => ({
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
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

const watchPosition = Location.watchPositionAsync as jest.Mock;

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('the foreground location watch', () => {
  let uninstall: (() => void) | undefined;
  let listener: ((state: string) => void) | null = null;
  let removals: jest.Mock[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    removals = [];
    watchPosition.mockImplementation(async () => {
      const remove = jest.fn();
      removals.push(remove);
      return { remove };
    });
    listener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _event: string,
      next: (state: string) => void
    ) => {
      listener = next;
      return { remove: jest.fn() };
    }) as never);
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

  it('is armed once when two callers arm it together', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    // The screen effect arms it on the same status change the session did.
    void ensureLocationWatch();
    await settle();

    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('is armed once when three callers arm it together', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    void ensureLocationWatch();
    void ensureLocationWatch();
    await settle();

    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('removes a watch that landed after the app went to the background', async () => {
    const remove = jest.fn();
    const held: { release?: () => void } = {};
    watchPosition.mockImplementationOnce(
      () =>
        new Promise<{ remove: jest.Mock }>((resolve) => {
          held.release = () => resolve({ remove });
        })
    );

    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    listener?.('background');
    await settle();
    held.release?.();
    await settle();

    expect(remove).toHaveBeenCalled();
  });

  it('removes the one watch it holds when the app goes to the background', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    void ensureLocationWatch();
    await settle();
    listener?.('background');
    await settle();

    expect(removals).toHaveLength(1);
    expect(removals[0]).toHaveBeenCalledTimes(1);
  });
});
