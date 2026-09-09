/**
 * Scenario: a widget, tile, shortcut or Siri phrase cold-starts the app straight
 * into the recording screen. On a release build that is fast enough to run the
 * session's effects before Android has resumed the activity, and Android then
 * refuses the foreground location service.
 *
 * Expected behaviour: nothing assumes the session began in the foreground. The
 * session reads the real app state, a refused service is recognised as refused
 * rather than taken on trust, it is retried on the transition into `active`, and
 * a start that never recovers says so instead of reading as a weak GPS signal.
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
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

const started = Location.startLocationUpdatesAsync as jest.Mock;
const hasStarted = Location.hasStartedLocationUpdatesAsync as jest.Mock;
const watchPosition = Location.watchPositionAsync as jest.Mock;

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('a cold start that beats the foreground transition', () => {
  let uninstall: () => void;
  let listener: ((state: string) => void) | null = null;

  function install(currentState: string) {
    listener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _event: string,
      next: (state: string) => void
    ) => {
      listener = next;
      return { remove: jest.fn() };
    }) as never);
    Object.defineProperty(AppState, 'currentState', {
      value: currentState,
      configurable: true,
    });
    uninstall = installRecordingSession();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    hasStarted.mockResolvedValue(true);
    useRecordingStore.getState().reset();
    useRecordingLiveStore.getState().reset();
  });

  afterEach(() => {
    uninstall?.();
    useRecordingStore.getState().reset();
    jest.restoreAllMocks();
  });

  it('does not start the screen watch before the activity is resumed', async () => {
    install('background');
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('starts it on the transition into active, not on a timer', async () => {
    install('background');
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    listener?.('active');
    await settle();
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('retries a refused service on that transition, which needs the real state', async () => {
    install('background');
    hasStarted.mockResolvedValue(false);
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(started).toHaveBeenCalledTimes(1);

    hasStarted.mockResolvedValue(true);
    listener?.('active');
    await settle();
    expect(started).toHaveBeenCalledTimes(2);
    expect(useRecordingLiveStore.getState().backgroundTrackingFailed).toBe(false);
  });

  it('does not take a silent refusal for a start, which is how a ride records nothing', async () => {
    install('active');
    // expo-location logs the refusal and resolves, so the promise is no signal.
    hasStarted.mockResolvedValue(false);
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(useRecordingLiveStore.getState().backgroundTrackingFailed).toBe(true);
  });

  it('does not re-arm a service that is already running', async () => {
    install('active');
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    listener?.('background');
    listener?.('active');
    await settle();
    expect(started).toHaveBeenCalledTimes(1);
  });
});

describe('a refused start is not a weak signal', () => {
  it('outranks the GPS warning and says something else', () => {
    const { selectStatusMessage } =
      require('@/features/recording/lib/statusSlot') as typeof import('@/features/recording/lib/statusSlot');
    const message = selectStatusMessage({
      backgroundTrackingWarning: 'Could not start GPS tracking. Try pausing and resuming.',
      gpsWarning: 'Waiting for GPS signal. Move outdoors for a better fix.',
      sensorIssue: null,
      splitBanner: null,
    });
    expect(message).toEqual({
      kind: 'background',
      text: 'Could not start GPS tracking. Try pausing and resuming.',
    });
  });
});
