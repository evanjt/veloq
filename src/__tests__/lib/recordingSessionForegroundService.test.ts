/**
 * Scenario: a rider starts a GPS recording and then leaves the app.
 *
 * Expected behaviour: Android 12 forbids an app that is already in the
 * background from starting a foreground service, so the service is armed while
 * the recording screen still holds the foreground. Backgrounding then only
 * swaps which watch consumes the fixes, and a start that fails anyway is told
 * to the rider rather than logged and dropped.
 */

import { AppState } from 'react-native';
import * as Location from 'expo-location';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';

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
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('the recording session and the foreground service', () => {
  let uninstall: () => void;
  let appStateListener: ((state: string) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _event: string,
      listener: (state: string) => void
    ) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as never);
    useRecordingStore.getState().reset();
    useRecordingLiveStore.getState().reset();
    uninstall = installRecordingSession();
  });

  afterEach(() => {
    uninstall();
    useRecordingStore.getState().reset();
    jest.restoreAllMocks();
  });

  it('arms the service while the recording screen still holds the foreground', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  /**
   * The bug: asking on the transition is asking from the background, which is
   * exactly what Android refuses.
   */
  it('does not ask again on the way out', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    (Location.startLocationUpdatesAsync as jest.Mock).mockClear();
    appStateListener?.('background');
    await settle();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('keeps the service through a return to the foreground', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    appStateListener?.('background');
    await settle();
    (Location.stopLocationUpdatesAsync as jest.Mock).mockClear();
    appStateListener?.('active');
    await settle();
    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('lets the service go when the ride ends', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    useRecordingStore.getState().stopRecording();
    await settle();
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
  });

  it('never asks for one in indoor mode', async () => {
    useRecordingStore.getState().startRecording('Ride', 'indoor');
    await settle();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('tells the rider when the service is refused anyway', async () => {
    (Location.startLocationUpdatesAsync as jest.Mock).mockRejectedValueOnce(
      new Error('Foreground service cannot be started when the application is in the background')
    );
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(useRecordingLiveStore.getState().backgroundTrackingFailed).toBe(true);
  });

  it('says nothing when the service starts', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(useRecordingLiveStore.getState().backgroundTrackingFailed).toBe(false);
  });
});
