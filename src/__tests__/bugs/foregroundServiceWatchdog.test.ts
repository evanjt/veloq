/**
 * Scenario: the location foreground service comes up a moment after it is asked
 * for, and the one check that decides whether to warn happens before it does.
 * The athlete is then told "Could not start GPS tracking. Try pausing and
 * resuming." for a ride that is recording perfectly well, which invites them to
 * interfere with a working session.
 *
 * Expected behaviour: the warning is not a latch. The session keeps asking while
 * the ride is live, clears the warning the moment the service is found running,
 * and raises it again if the service later dies. A state that can only ever be
 * entered is not a state, and the same shape hid the original bug on the
 * detection side.
 */

import { AppState } from 'react-native';
import * as Location from 'expo-location';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';

const mockLocationServiceRunning = jest.fn();

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  installRecordingNotificationActions: jest.fn(() => jest.fn()),
  updateRecordingNotification: jest.fn(),
  clearRecordingNotification: jest.fn(),
  locationServiceRunning: (...a: unknown[]) => mockLocationServiceRunning(...a),
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

const failed = () => useRecordingLiveStore.getState().backgroundTrackingFailed;

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

/** Run the watchdog's next tick and let its promises resolve. */
async function tick(): Promise<void> {
  await jest.advanceTimersByTimeAsync(SERVICE_WATCH_MS);
  await settle();
}

const SERVICE_WATCH_MS = 3000;

describe('the tracking warning is re-decided, not latched', () => {
  let uninstall: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({
      remove: jest.fn(),
    })) as never);
    useRecordingStore.getState().reset();
    useRecordingLiveStore.getState().reset();
    uninstall = installRecordingSession();
  });

  afterEach(() => {
    uninstall();
    useRecordingStore.getState().reset();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('clears the warning once a slow service is found running', async () => {
    // False at the start, which is the 6-in-15 shape, then true a moment later.
    mockLocationServiceRunning.mockResolvedValue(false);
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    await jest.advanceTimersByTimeAsync(3000);
    await settle();
    expect(failed()).toBe(true);

    mockLocationServiceRunning.mockResolvedValue(true);
    await tick();
    expect(failed()).toBe(false);
  });

  it('raises it again if the service later dies, so it is not a one-way door either way', async () => {
    mockLocationServiceRunning.mockResolvedValue(true);
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(failed()).toBe(false);

    mockLocationServiceRunning.mockResolvedValue(false);
    await tick();
    expect(failed()).toBe(true);
  });

  it('re-arms a service it finds gone rather than only re-labelling it', async () => {
    mockLocationServiceRunning.mockResolvedValue(true);
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    const armedOnce = (Location.startLocationUpdatesAsync as jest.Mock).mock.calls.length;

    mockLocationServiceRunning.mockResolvedValue(false);
    await tick();
    expect((Location.startLocationUpdatesAsync as jest.Mock).mock.calls.length).toBeGreaterThan(
      armedOnce
    );
  });

  it('says nothing when it cannot tell, rather than guessing', async () => {
    mockLocationServiceRunning.mockResolvedValue(null);
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    await tick();
    expect(failed()).toBe(false);
  });

  it('stops asking once the ride is over', async () => {
    mockLocationServiceRunning.mockResolvedValue(true);
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    useRecordingStore.getState().stopRecording();
    await settle();
    mockLocationServiceRunning.mockClear();
    await tick();
    expect(mockLocationServiceRunning).not.toHaveBeenCalled();
  });

  it('does not watch an indoor session, which has no location service at all', async () => {
    mockLocationServiceRunning.mockResolvedValue(false);
    useRecordingStore.getState().startRecording('VirtualRide', 'indoor');
    await settle();
    await tick();
    expect(mockLocationServiceRunning).not.toHaveBeenCalled();
    expect(failed()).toBe(false);
  });
});
