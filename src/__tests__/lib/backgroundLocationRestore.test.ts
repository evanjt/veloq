/**
 * Scenario: Android kills the app mid-ride while the foreground service keeps
 * the location request alive, and the next batch is delivered by loading the
 * bundle headlessly.
 *
 * Expected behaviour: the handler cannot read the session from memory, because
 * the runtime is fresh and the store is idle. It rehydrates from the crash
 * backup, appends the batch, and persists it itself, so the notification and
 * the recording say the same thing.
 */

import type { RecordingBackup } from '@/features/recording/types';

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  loadRecordingBackup: jest.fn(),
  saveRecordingBackup: jest.fn(),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  startLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

const START_TIME = 1_700_000_000_000;

// Each test is its own JS runtime, the way a headless wake-up is. Module state
// that survived between tests would hide the very flag the fix turns on.
function freshRuntime() {
  jest.resetModules();
  const { useRecordingStore } = require('@/features/recording/stores/RecordingStore');
  const { useAuthStore } = require('@/shared/app/AuthStore');
  const { useRecordingLiveStore } = require('@/features/recording/stores/RecordingLiveStore');
  const { handleBackgroundLocations } = require('@/features/recording/lib/backgroundLocation');
  const { loadRecordingBackup, saveRecordingBackup } =
    require('@/features/recording/lib/storage/recordingBackup') as {
      loadRecordingBackup: jest.Mock;
      saveRecordingBackup: jest.Mock;
    };
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true, isLoading: false });
  return {
    useRecordingStore,
    useAuthStore,
    useRecordingLiveStore,
    handleBackgroundLocations,
    loadRecordingBackup,
    saveRecordingBackup,
  };
}

function backupAt(status: RecordingBackup['status'], savedAtSeconds: number): RecordingBackup {
  return {
    athleteId: 'i1',
    activityType: 'Ride',
    mode: 'gps',
    status,
    startTime: START_TIME,
    stopTime: status === 'stopped' ? START_TIME + savedAtSeconds * 1000 : null,
    pausedDuration: 0,
    pauseIntervals: [],
    streams: {
      time: [0],
      latlng: [[47.5, 8.5]],
      altitude: [400],
      heartrate: [0],
      power: [0],
      cadence: [0],
      speed: [0],
      distance: [0],
    },
    laps: [],
    pairedEventId: null,
    savedAt: START_TIME + savedAtSeconds * 1000,
  };
}

function locationsFrom(seconds: number[], metresNorth: number[]) {
  return seconds.map((second, index) => ({
    coords: {
      latitude: 47.5 + metresNorth[index] / 111_320,
      longitude: 8.5,
      altitude: 400,
      accuracy: 5,
      speed: null,
      heading: null,
    },
    timestamp: START_TIME + second * 1000,
  }));
}

describe('background location in a headless runtime', () => {
  beforeEach(() => jest.clearAllMocks());

  it('restores the session from the backup and appends the batch', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(backupAt('recording', 60));

    await rt.handleBackgroundLocations(locationsFrom([70, 80], [100, 200]));

    const state = rt.useRecordingStore.getState();
    expect(state.status).toBe('recording');
    expect(state.startTime).toBe(START_TIME);
    expect(state.streams.time).toEqual([0, 70, 80]);
    expect(rt.saveRecordingBackup).toHaveBeenCalledTimes(1);
  });

  it('appends a second batch without restoring again', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(backupAt('recording', 60));

    await rt.handleBackgroundLocations(locationsFrom([70], [100]));
    await rt.handleBackgroundLocations(locationsFrom([90], [300]));

    expect(rt.loadRecordingBackup).toHaveBeenCalledTimes(1);
    expect(rt.useRecordingStore.getState().streams.time).toEqual([0, 70, 90]);
    expect(rt.saveRecordingBackup).toHaveBeenCalledTimes(2);
  });

  it('drops the batch when there is no backup', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(null);

    await rt.handleBackgroundLocations(locationsFrom([70], [100]));

    expect(rt.useRecordingStore.getState().status).toBe('idle');
    expect(rt.useRecordingStore.getState().streams.time).toHaveLength(0);
    expect(rt.saveRecordingBackup).not.toHaveBeenCalled();
  });

  it('does not restore another athlete or an ownerless backup', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue({ ...backupAt('recording', 60), athleteId: 'i2' });
    await rt.handleBackgroundLocations(locationsFrom([70], [100]));
    expect(rt.useRecordingStore.getState().status).toBe('idle');

    const signedOut = freshRuntime();
    signedOut.useAuthStore.setState({ athleteId: null, isAuthenticated: false });
    signedOut.loadRecordingBackup.mockResolvedValue({
      ...backupAt('recording', 60),
      athleteId: undefined,
    });
    await signedOut.handleBackgroundLocations(locationsFrom([70], [100]));
    expect(signedOut.useRecordingStore.getState().status).toBe('idle');
  });

  it('does not resurrect a session the rider already stopped', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(backupAt('stopped', 60));

    await rt.handleBackgroundLocations(locationsFrom([70], [100]));

    expect(rt.useRecordingStore.getState().status).toBe('idle');
    expect(rt.saveRecordingBackup).not.toHaveBeenCalled();
  });

  it('restores a paused session and reopens its pause at the last save', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(backupAt('paused', 60));

    await rt.handleBackgroundLocations(locationsFrom([70, 80], [100, 200]));

    const state = rt.useRecordingStore.getState();
    expect(state.status).toBe('paused');
    // A paused session drops the points but keeps the raw fixes, so auto-pause
    // can still see the rider set off again.
    expect(state.streams.time).toEqual([0]);
    expect(state._pauseStart).toBe(START_TIME + 60_000);
    expect(state.rawSpeed?.value).toBeCloseTo(10, 1);
  });

  it('leaves a live in-memory session alone', async () => {
    const rt = freshRuntime();
    rt.useRecordingStore.getState().startRecording('Ride', 'gps');

    await rt.handleBackgroundLocations(locationsFrom([70], [100]));

    expect(rt.loadRecordingBackup).not.toHaveBeenCalled();
    expect(rt.saveRecordingBackup).not.toHaveBeenCalled();
    expect(rt.useRecordingStore.getState().streams.time).toHaveLength(1);
  });

  it('records a fix whose altitude iOS marked invalid as missing', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(backupAt('recording', 60));
    const batch = locationsFrom([70, 80], [100, 200]);
    Object.assign(batch[0].coords, { altitude: 0, altitudeAccuracy: -1 });

    await rt.handleBackgroundLocations(batch);

    expect(rt.useRecordingStore.getState().streams.altitude).toEqual([400, NaN, 400]);
  });

  it.each(['recording', 'paused'] as const)(
    'never persists an empty or restarted %s ride while restoring it',
    async (status) => {
      const rt = freshRuntime();
      // The headless bundle installs the session like any launch, so its
      // listener sees every state the restore passes through.
      const { installRecordingSession } = require('@/features/recording/lib/recordingSession');
      const uninstall = installRecordingSession();
      const backup = backupAt(status, 60);
      rt.loadRecordingBackup.mockResolvedValue(backup);

      await rt.handleBackgroundLocations(locationsFrom([70], [100]));
      for (let i = 0; i < 10; i++) await Promise.resolve();

      expect(rt.saveRecordingBackup).toHaveBeenCalled();
      for (const [written] of rt.saveRecordingBackup.mock.calls) {
        expect(written.startTime).toBe(START_TIME);
        expect(written.streams.time.slice(0, 1)).toEqual([0]);
      }
      const { streamTotals } = require('@/features/recording/stores/RecordingStore');
      const state = rt.useRecordingStore.getState();
      expect(state.totals).toEqual(streamTotals(state.streams));
      uninstall();
    }
  );

  it('ignores an empty batch', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(backupAt('recording', 60));

    await rt.handleBackgroundLocations([]);

    expect(rt.loadRecordingBackup).not.toHaveBeenCalled();
    expect(rt.useRecordingStore.getState().status).toBe('idle');
  });

  describe('auto-pause across a headless restore', () => {
    // One fix a second at a steady speed, the way the service batches them.
    function batchAt(fromSecond: number, count: number, metresPerSecond: number) {
      return Array.from({ length: count }, (_, i) => ({
        coords: {
          latitude: 47.5 + ((fromSecond + i) * metresPerSecond) / 111_320,
          longitude: 8.5,
          altitude: 400,
          accuracy: 5,
          speed: metresPerSecond,
          heading: null,
        },
        timestamp: START_TIME + (fromSecond + i) * 1000,
      }));
    }

    function withSession(installed: boolean): () => void {
      if (!installed) return () => undefined;
      const { installRecordingSession } = require('@/features/recording/lib/recordingSession');
      return installRecordingSession();
    }

    it.each([false, true])(
      'resumes a ride restored while auto-paused once the rider sets off (session installed: %s)',
      async (installed) => {
        const rt = freshRuntime();
        const uninstall = withSession(installed);
        rt.loadRecordingBackup.mockResolvedValue({ ...backupAt('paused', 60), autoPaused: true });

        await rt.handleBackgroundLocations(batchAt(70, 3, 8));

        const state = rt.useRecordingStore.getState();
        expect(state.status).toBe('recording');
        expect(state.streams.time).toEqual([0, 70, 71, 72]);
        uninstall();
      }
    );

    it.each([false, true])(
      'keeps a ride the rider paused by hand paused when they move (session installed: %s)',
      async (installed) => {
        const rt = freshRuntime();
        const uninstall = withSession(installed);
        rt.loadRecordingBackup.mockResolvedValue(backupAt('paused', 60));

        await rt.handleBackgroundLocations(batchAt(70, 3, 8));

        const state = rt.useRecordingStore.getState();
        expect(state.status).toBe('paused');
        expect(state.streams.time).toEqual([0]);
        uninstall();
      }
    );

    it.each([false, true])(
      'restores an auto-paused ride as paused by hand when auto-pause is off (session installed: %s)',
      async (installed) => {
        const rt = freshRuntime();
        const AsyncStorage = require('@react-native-async-storage/async-storage');
        await AsyncStorage.setItem(
          'veloq-recording-preferences',
          JSON.stringify({ autoPauseEnabled: false })
        );
        const uninstall = withSession(installed);
        rt.loadRecordingBackup.mockResolvedValue({ ...backupAt('paused', 60), autoPaused: true });

        await rt.handleBackgroundLocations(batchAt(70, 3, 8));

        expect(rt.useRecordingLiveStore.getState().autoPaused).toBe(false);
        expect(rt.useRecordingStore.getState().status).toBe('paused');
        uninstall();
      }
    );

    it('auto-pauses a restored ride that stops, and saves why it is paused', async () => {
      const rt = freshRuntime();
      rt.loadRecordingBackup.mockResolvedValue(backupAt('recording', 60));

      await rt.handleBackgroundLocations([...batchAt(68, 2, 8), ...batchAt(70, 8, 0)]);

      expect(rt.useRecordingStore.getState().status).toBe('paused');
      const saved = rt.saveRecordingBackup.mock.calls.at(-1)?.[0];
      expect(saved.status).toBe('paused');
      expect(saved.autoPaused).toBe(true);

      await rt.handleBackgroundLocations(batchAt(78, 2, 8));
      expect(rt.useRecordingStore.getState().status).toBe('recording');
      expect(rt.saveRecordingBackup.mock.calls.at(-1)?.[0].autoPaused).toBeUndefined();
    });

    it('does not auto-pause a restored ride when the rider turned auto-pause off', async () => {
      const rt = freshRuntime();
      const AsyncStorage = require('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem(
        'veloq-recording-preferences',
        JSON.stringify({ autoPauseEnabled: false })
      );
      rt.loadRecordingBackup.mockResolvedValue(backupAt('recording', 60));

      await rt.handleBackgroundLocations(batchAt(70, 8, 0));

      expect(rt.useRecordingStore.getState().status).toBe('recording');
      await AsyncStorage.removeItem('veloq-recording-preferences');
    });
  });
});
