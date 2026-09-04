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
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

const START_TIME = 1_700_000_000_000;

// Each test is its own JS runtime, the way a headless wake-up is. Module state
// that survived between tests would hide the very flag the fix turns on.
function freshRuntime() {
  jest.resetModules();
  const { useRecordingStore } = require('@/features/recording/stores/RecordingStore');
  const { handleBackgroundLocations } = require('@/features/recording/lib/backgroundLocation');
  const { loadRecordingBackup, saveRecordingBackup } =
    require('@/features/recording/lib/storage/recordingBackup') as {
      loadRecordingBackup: jest.Mock;
      saveRecordingBackup: jest.Mock;
    };
  useRecordingStore.getState().reset();
  return { useRecordingStore, handleBackgroundLocations, loadRecordingBackup, saveRecordingBackup };
}

function backupAt(status: RecordingBackup['status'], savedAtSeconds: number): RecordingBackup {
  return {
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

  it('ignores an empty batch', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(backupAt('recording', 60));

    await rt.handleBackgroundLocations([]);

    expect(rt.loadRecordingBackup).not.toHaveBeenCalled();
    expect(rt.useRecordingStore.getState().status).toBe('idle');
  });
});
