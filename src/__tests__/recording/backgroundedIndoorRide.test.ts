/**
 * Scenario: a rider on a trainer, with a heart-rate strap and a power meter
 * paired, locks the phone or switches apps mid-ride. React Native pauses JS
 * timers while the host is backgrounded, so the 1 Hz indoor tick and the
 * periodic backup both stop, while sensor notifications keep arriving.
 *
 * Expected behaviour: the ride goes to disk on the way out, a foreground
 * service keeps the process alive on Android, and each sensor notification
 * that lands a second or more after the last sample records the next one, so
 * the series carries on and the backup keeps moving.
 */

import { AppState } from 'react-native';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import {
  startIndoorRecordingService,
  stopIndoorRecordingService,
} from '@/features/recording/lib/recordingNotification';
import { saveRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { BACKUP_INTERVAL_MS } from '@/features/recording/lib/constants';

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  installRecordingNotificationActions: jest.fn(() => jest.fn()),
  updateRecordingNotification: jest.fn(),
  clearRecordingNotification: jest.fn(),
  locationServiceRunning: jest.fn(async () => true),
  startIndoorRecordingService: jest.fn(() => true),
  stopIndoorRecordingService: jest.fn(),
}));

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  saveRecordingBackup: jest.fn(async () => true),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

const START = 1_700_000_000_000;

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Move the wall clock without firing a timer, as a backgrounded host does. */
function wallClockAt(secondsIn: number): void {
  jest.setSystemTime(START + secondsIn * 1000);
}

function sensor(kind: 'heartrate' | 'power' | 'cadence', value: number, secondsIn: number): void {
  wallClockAt(secondsIn);
  useRecordingStore.getState().setSensorSample(kind, value);
}

const saved = saveRecordingBackup as jest.Mock;

describe('an indoor ride out of the foreground', () => {
  let uninstall: () => void;
  let appStateListener: ((state: string) => void) | null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: START });
    appStateListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _event: string,
      listener: (state: string) => void
    ) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as never);
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
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

  function startIndoorRide(): void {
    useRecordingStore.getState().startRecording('VirtualRide', 'indoor');
  }

  function leaveTheApp(): void {
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    appStateListener?.('background');
  }

  it('writes the ride to disk on the way out of the foreground', async () => {
    startIndoorRide();
    jest.advanceTimersByTime(5_000);
    await settle();
    saved.mockClear();

    leaveTheApp();
    await settle();

    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0][0].streams.time).toHaveLength(5);
  });

  it('asks for the indoor foreground service when the ride starts, and lets it go at the end', async () => {
    startIndoorRide();
    await settle();
    expect(startIndoorRecordingService).toHaveBeenCalledTimes(1);
    expect(stopIndoorRecordingService).not.toHaveBeenCalled();

    useRecordingStore.getState().stopRecording();
    await settle();
    expect(stopIndoorRecordingService).toHaveBeenCalled();
  });

  it('does not ask for the indoor service for a GPS ride', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(startIndoorRecordingService).not.toHaveBeenCalled();
  });

  it('lets the indoor service go when the sport changes to an outdoor one', async () => {
    startIndoorRide();
    await settle();
    useRecordingStore.getState().changeActivityType('Ride');
    await settle();
    expect(useRecordingStore.getState().mode).toBe('gps');
    expect(stopIndoorRecordingService).toHaveBeenCalled();
  });

  it('records a sample from each sensor notification a second or more after the last', async () => {
    startIndoorRide();
    jest.advanceTimersByTime(3_000);
    await settle();
    expect(useRecordingStore.getState().streams.time).toEqual([1, 2, 3]);
    leaveTheApp();
    await settle();

    // Timers are paused in the background, so only the notifications drive it.
    sensor('heartrate', 140, 3.4);
    sensor('power', 210, 4.1);
    sensor('cadence', 88, 4.6);
    sensor('heartrate', 141, 5.2);
    sensor('power', 215, 6.3);

    const { streams } = useRecordingStore.getState();
    expect(streams.time).toEqual([1, 2, 3, 4.1, 5.2, 6.3]);
    expect(streams.heartrate.slice(3)).toEqual([140, 141, 141]);
    expect(streams.power.slice(3)).toEqual([210, 210, 215]);
    expect(streams.cadence.slice(3)).toEqual([0, 88, 88]);
  });

  it('keeps writing the backup from the notifications once an interval has passed', async () => {
    startIndoorRide();
    jest.advanceTimersByTime(2_000);
    await settle();
    leaveTheApp();
    await settle();
    saved.mockClear();

    const intervalSeconds = BACKUP_INTERVAL_MS / 1000;
    for (let second = 3; second <= 2 + intervalSeconds; second++) {
      sensor('heartrate', 140, second);
    }
    await settle();
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0][0].streams.time.at(-1)).toBe(2 + intervalSeconds);
  });

  it('leaves the sampling to the tick while the app is in front', async () => {
    startIndoorRide();
    jest.advanceTimersByTime(1_000);
    await settle();

    sensor('heartrate', 140, 2.5);
    sensor('heartrate', 141, 3.7);

    expect(useRecordingStore.getState().streams.time).toEqual([1]);
  });

  it('records nothing from a notification while the ride is paused', async () => {
    startIndoorRide();
    jest.advanceTimersByTime(1_000);
    await settle();
    useRecordingStore.getState().pauseRecording();
    leaveTheApp();
    await settle();

    sensor('heartrate', 140, 4);

    expect(useRecordingStore.getState().streams.time).toEqual([1]);
  });

  it('takes the sampler back to the tick when the rider returns', async () => {
    startIndoorRide();
    await settle();
    leaveTheApp();
    await settle();
    sensor('heartrate', 140, 1.5);
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    appStateListener?.('active');
    await settle();

    sensor('heartrate', 141, 3);

    expect(useRecordingStore.getState().streams.time).toEqual([1.5]);
  });
});
