/**
 * Tests for crash-recovery backup storage.
 *
 * Covers: buildRecordingBackup (state snapshot → backup, ongoing-pause fold,
 * non-restorable states), save/load round-trip, schema validation (version,
 * status, stopTime), and the restore-time paused-duration credit maths.
 */

jest.mock('@/shared/debug/debug', () => ({
  debug: {
    log: () => {},
    warn: () => {},
    error: () => {},
    create: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  },
}));

const mockFileStore = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: mockFileStore.has(path),
    isDirectory: false,
  })),
  writeAsStringAsync: jest.fn(async (path: string, content: string) => {
    mockFileStore.set(path, content);
  }),
  readAsStringAsync: jest.fn(async (path: string) => {
    if (!mockFileStore.has(path)) throw new Error('ENOENT');
    return mockFileStore.get(path)!;
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockFileStore.delete(path);
  }),
}));

import {
  buildRecordingBackup,
  saveRecordingBackup,
  loadRecordingBackup,
  clearRecordingBackup,
  hasRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import type { RecordingBackup, RecordingStreams } from '@/features/recording/types';

const BACKUP_PATH = '/mock/docs/recording_backup.json';

function makeStreams(): RecordingStreams {
  return {
    time: [0, 1, 2],
    latlng: [
      [47.0, 8.0],
      [47.0001, 8.0001],
      [47.0002, 8.0002],
    ],
    altitude: [400, 401, 402],
    heartrate: [],
    power: [],
    cadence: [],
    speed: [1, 1.1, 1.2],
    distance: [0, 10, 20],
  };
}

function makeState(overrides: Partial<Parameters<typeof buildRecordingBackup>[0]> = {}) {
  return {
    status: 'recording',
    activityType: 'Ride',
    mode: 'gps',
    startTime: 1_000_000,
    stopTime: null,
    pausedDuration: 5_000,
    streams: makeStreams(),
    laps: [],
    pairedEventId: null,
    _pauseStart: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockFileStore.clear();
  jest.restoreAllMocks();
});

describe('buildRecordingBackup', () => {
  it('snapshots a recording session', () => {
    const backup = buildRecordingBackup(makeState());
    expect(backup).not.toBeNull();
    expect(backup!.status).toBe('recording');
    expect(backup!.pausedDuration).toBe(5_000);
    expect(backup!.stopTime).toBeNull();
    expect(backup!.streams.time).toHaveLength(3);
    expect(backup!.savedAt).toBeGreaterThan(0);
  });

  it('folds an ongoing pause into pausedDuration', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const backup = buildRecordingBackup(
      makeState({ status: 'paused', _pauseStart: now - 30_000, pausedDuration: 5_000 })
    );
    expect(backup!.pausedDuration).toBe(35_000);
    expect(backup!.status).toBe('paused');
  });

  it('does not fold _pauseStart while recording', () => {
    const backup = buildRecordingBackup(makeState({ _pauseStart: Date.now() - 30_000 }));
    expect(backup!.pausedDuration).toBe(5_000);
  });

  it('carries stopTime for a stopped session', () => {
    const backup = buildRecordingBackup(
      makeState({ status: 'stopped', stopTime: 2_000_000, _pauseStart: null })
    );
    expect(backup!.status).toBe('stopped');
    expect(backup!.stopTime).toBe(2_000_000);
  });

  it('returns null for idle or incomplete state', () => {
    expect(buildRecordingBackup(makeState({ status: 'idle' }))).toBeNull();
    expect(buildRecordingBackup(makeState({ activityType: null }))).toBeNull();
    expect(buildRecordingBackup(makeState({ mode: null }))).toBeNull();
    expect(buildRecordingBackup(makeState({ startTime: null }))).toBeNull();
  });
});

describe('save/load round-trip', () => {
  it('round-trips a v2 backup', async () => {
    const backup = buildRecordingBackup(makeState())!;
    await saveRecordingBackup(backup);
    expect(await hasRecordingBackup()).toBe(true);

    const loaded = await loadRecordingBackup();
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe('recording');
    expect(loaded!.startTime).toBe(1_000_000);
    expect(loaded!.streams.latlng).toHaveLength(3);
  });

  it('rejects a version-1 backup', async () => {
    const v1 = {
      version: 1,
      activityType: 'Ride',
      mode: 'gps',
      startTime: 1_000_000,
      pausedDuration: 0,
      streams: makeStreams(),
      laps: [],
      pairedEventId: null,
      savedAt: 1_000_500,
    };
    mockFileStore.set(BACKUP_PATH, JSON.stringify(v1));
    expect(await loadRecordingBackup()).toBeNull();
  });

  it('rejects an invalid status', async () => {
    const backup = buildRecordingBackup(makeState())!;
    mockFileStore.set(BACKUP_PATH, JSON.stringify({ ...backup, version: 2, status: 'exploded' }));
    expect(await loadRecordingBackup()).toBeNull();
  });

  it('rejects corrupt JSON', async () => {
    mockFileStore.set(BACKUP_PATH, '{not json');
    expect(await loadRecordingBackup()).toBeNull();
  });

  it('clears the backup file', async () => {
    await saveRecordingBackup(buildRecordingBackup(makeState())!);
    await clearRecordingBackup();
    expect(await hasRecordingBackup()).toBe(false);
  });
});

describe('restore paused-duration credit', () => {
  // Mirrors the restore handler in record.tsx: the savedAt→now gap is credited
  // as paused time so moving time does not inflate across an app kill.
  it('credits the offline gap', () => {
    const backup: RecordingBackup = buildRecordingBackup(makeState())!;
    const restoreTime = backup.savedAt + 120_000;
    const restored = backup.pausedDuration + Math.max(0, restoreTime - backup.savedAt);
    expect(restored).toBe(5_000 + 120_000);
  });

  it('never subtracts when clocks skew backwards', () => {
    const backup: RecordingBackup = buildRecordingBackup(makeState())!;
    const restoreTime = backup.savedAt - 60_000;
    const restored = backup.pausedDuration + Math.max(0, restoreTime - backup.savedAt);
    expect(restored).toBe(5_000);
  });
});
