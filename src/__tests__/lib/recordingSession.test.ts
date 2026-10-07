/**
 * Scenario: a rider starts a GPS recording, taps a tab to look at the feed,
 * then comes back to the recording screen.
 *
 * Expected behaviour: the location watch, the indoor tick and the crash backup
 * belong to the session, not to the screen. Nothing unmounting takes them
 * down; only `stopRecording` or `reset` does.
 */

import { renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import { saveRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { BACKUP_INTERVAL_MS } from '@/features/recording/lib/constants';
import { useGpsSessionEffect } from '@/features/recording/hooks/useGpsSessionEffect';

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  buildRecordingBackup: jest.fn(() => ({ startTime: 1 })),
  saveRecordingBackup: jest.fn(),
  clearRecordingBackup: jest.fn(),
}));

const watchRemove = jest.fn();
let onFix: ((location: unknown) => void) | null = null;

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  watchPositionAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

function fixAt(secondsIn: number, metresNorth: number) {
  return {
    coords: {
      latitude: 47.5 + metresNorth / 111_320,
      longitude: 8.5,
      altitude: 400,
      accuracy: 5,
      speed: null,
      heading: null,
    },
    timestamp: 1_700_000_000_000 + secondsIn * 1000,
  };
}

// The watch is started from an async path, and the timers are fake, so drain
// the microtask queue rather than waiting on one.
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('recordingSession', () => {
  let uninstall: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (Location.watchPositionAsync as jest.Mock).mockImplementation(
      async (_options: unknown, callback: (location: unknown) => void) => {
        onFix = callback;
        return { remove: watchRemove };
      }
    );
    useRecordingStore.getState().reset();
    useRecordingLiveStore.getState().reset();
    uninstall = installRecordingSession();
  });

  afterEach(() => {
    uninstall();
    jest.useRealTimers();
  });

  it('starts the location watch on startRecording and stops it on stopRecording', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    useRecordingStore.getState().stopRecording();
    await settle();
    expect(watchRemove).toHaveBeenCalledTimes(1);
  });

  it('does not start a live session for a manual entry', async () => {
    useRecordingStore.getState().startRecording('Yoga', 'manual');
    await settle();
    expect(saveRecordingBackup).not.toHaveBeenCalled();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('stops the watch on reset', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();

    useRecordingStore.getState().reset();
    await settle();
    expect(watchRemove).toHaveBeenCalledTimes(1);
  });

  it('keeps one watch when startRecording is called twice', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    useRecordingStore.getState().startRecording('Run', 'gps');
    await settle();

    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(watchRemove).not.toHaveBeenCalled();
  });

  it('records fixes and publishes them to the live store', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();

    onFix?.(fixAt(0, 0));
    onFix?.(fixAt(1, 10));

    expect(useRecordingStore.getState().streams.latlng).toHaveLength(2);
    expect(useRecordingLiveStore.getState().accuracy).toBe(5);
    expect(useRecordingLiveStore.getState().lastFixAt).not.toBeNull();
  });

  it('records a fix whose altitude iOS marked invalid as missing', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();

    // Core Location reports an invalid altitude as a number with a negative
    // vertical accuracy, not as null.
    const first = fixAt(0, 0);
    Object.assign(first.coords, { altitude: 0, altitudeAccuracy: -1 });
    onFix?.(first);
    onFix?.({ ...fixAt(1, 10), coords: { ...fixAt(1, 10).coords, altitude: 450 } });
    onFix?.({ ...fixAt(2, 20), coords: { ...fixAt(2, 20).coords, altitude: 452 } });

    const { streams, totals } = useRecordingStore.getState();
    expect(streams.altitude).toEqual([NaN, 450, 452]);
    expect(totals.elevationGain).toBe(2);
  });

  it('drops fixes worse than the accuracy threshold but still shows them', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();

    const coarse = fixAt(0, 0);
    coarse.coords.accuracy = 500;
    onFix?.(coarse);

    expect(useRecordingStore.getState().streams.latlng).toHaveLength(0);
    expect(useRecordingLiveStore.getState().accuracy).toBe(500);
  });

  it('ticks indoor samples instead of watching location for an indoor mode', async () => {
    useRecordingStore.getState().startRecording('VirtualRide', 'indoor');
    await settle();

    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3000);
    expect(useRecordingStore.getState().streams.time.length).toBeGreaterThanOrEqual(2);

    useRecordingStore.getState().stopRecording();
    const settled = useRecordingStore.getState().streams.time.length;
    jest.advanceTimersByTime(3000);
    expect(useRecordingStore.getState().streams.time).toHaveLength(settled);
  });

  it('switches from the indoor sampler to the location watch when the sport becomes outdoor', async () => {
    useRecordingStore.getState().startRecording('VirtualRide', 'indoor');
    await settle();
    jest.advanceTimersByTime(2000);
    const indoorSamples = useRecordingStore.getState().streams.time.length;
    expect(indoorSamples).toBeGreaterThanOrEqual(1);
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();

    useRecordingStore.getState().changeActivityType('Ride');
    await settle();

    expect(useRecordingStore.getState().mode).toBe('gps');
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    const timeBefore = useRecordingStore.getState().streams.time.length;
    jest.advanceTimersByTime(3000);
    expect(useRecordingStore.getState().streams.time).toHaveLength(timeBefore);

    const first = fixAt(0, 0);
    onFix?.({ ...first, timestamp: Date.now() + 1000 });
    const { streams } = useRecordingStore.getState();
    expect(streams.time).toHaveLength(timeBefore + 1);
    expect(streams.latlng).toHaveLength(streams.time.length);
    expect(streams.latlng[0]).toEqual([0, 0]);
    expect(streams.latlng[streams.latlng.length - 1][0]).toBeCloseTo(47.5, 3);
  });

  it('switches from the location watch to the indoor sampler and keeps the track so far', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    const now = Date.now();
    onFix?.({ ...fixAt(0, 0), timestamp: now + 1000 });
    onFix?.({ ...fixAt(0, 5), timestamp: now + 2000 });
    expect(useRecordingStore.getState().streams.latlng).toHaveLength(2);

    useRecordingStore.getState().changeActivityType('VirtualRide');
    await settle();

    expect(useRecordingStore.getState().mode).toBe('indoor');
    expect(watchRemove).toHaveBeenCalledTimes(1);
    expect(useRecordingStore.getState().streams.latlng).toHaveLength(2);

    jest.advanceTimersByTime(3000);
    const { streams } = useRecordingStore.getState();
    expect(streams.time.length).toBeGreaterThan(2);
    expect(streams.latlng).toHaveLength(2);
  });

  it('does not set a mode on a sport change before the ride has started', () => {
    useRecordingStore.getState().changeActivityType('Run');
    expect(useRecordingStore.getState().mode).toBeNull();
  });

  it('writes a crash backup on start and on the interval, and stops on reset', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    expect(saveRecordingBackup).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(BACKUP_INTERVAL_MS * 2);
    expect(saveRecordingBackup).toHaveBeenCalledTimes(3);

    useRecordingStore.getState().reset();
    await settle();
    (saveRecordingBackup as jest.Mock).mockClear();
    jest.advanceTimersByTime(BACKUP_INTERVAL_MS * 2);
    expect(saveRecordingBackup).not.toHaveBeenCalled();
  });

  it('keeps the watch running when the recording screen unmounts', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();

    const { unmount } = renderHook(() =>
      useGpsSessionEffect({
        mode: 'gps',
        status: 'recording',
        hasPermission: true,
        requestPermission: async () => true,
        setGpsWarning: () => {},
      })
    );
    await settle();
    unmount();
    await settle();

    expect(watchRemove).not.toHaveBeenCalled();
    expect(useRecordingStore.getState().status).toBe('recording');

    onFix?.(fixAt(0, 0));
    expect(useRecordingStore.getState().streams.latlng).toHaveLength(1);
  });

  it('does nothing for a session that never started', async () => {
    jest.advanceTimersByTime(BACKUP_INTERVAL_MS * 2);
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(saveRecordingBackup).not.toHaveBeenCalled();
  });
});
