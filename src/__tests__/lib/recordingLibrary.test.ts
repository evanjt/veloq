/**
 * Tests for the recordings library storage.
 *
 * Covers: saveRecording (FIT + streams sidecar + index), listing order,
 * status transitions (uploaded / retriable failure / rejection /
 * permission-blocked / requeue), the never-delete guarantee on exhausted
 * retries, exponential backoff eligibility, logout demotion, user deletion,
 * counts, and legacy pending_uploads migration.
 */

import {
  saveRecording,
  listRecordings,
  getRecording,
  readRecordingFit,
  readRecordingStreams,
  markRecordingUploaded,
  markRecordingUploadFailed,
  markRecordingRejected,
  markRecordingPermissionBlocked,
  requeueRecording,
  clearPermissionBlocked,
  demotePendingToLocalOnly,
  nextPendingUpload,
  deleteRecording,
  getUnuploadedCount,
  getPermissionBlockedCount,
  isRetryEligible,
  migrateLegacyUploadQueue,
  adoptAsyncStorageIndex,
  bufferToBase64,
} from '@/features/recording/lib/storage/recordingLibrary';
import type { RecordingStreams } from '@/features/recording/types';

jest.mock('@/shared/debug/debug', () => ({
  debug: {
    log: () => {},
    warn: () => {},
    error: () => {},
    create: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  },
}));

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/docs/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: mockDirStore.has(path) || mockFileStore.has(path),
    isDirectory: mockDirStore.has(path),
  })),
  makeDirectoryAsync: jest.fn(async (path: string) => {
    mockDirStore.add(path);
  }),
  writeAsStringAsync: jest.fn(async (path: string, content: string) => {
    mockFileStore.set(path, content);
  }),
  readAsStringAsync: jest.fn(async (path: string) => {
    if (!mockFileStore.has(path)) throw new Error('ENOENT');
    return mockFileStore.get(path)!;
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockFileStore.delete(path);
    mockDirStore.delete(path);
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!mockFileStore.has(from)) throw new Error('ENOENT');
    mockFileStore.set(to, mockFileStore.get(from)!);
    mockFileStore.delete(from);
  }),
}));

/**
 * The recording table, in memory.
 *
 * The engine owns the index now, so the storage module is tested against a
 * stand-in with the same semantics rather than against AsyncStorage. What the
 * real table does is pinned on the Rust side, in
 * `persistence::recordings::tests`; what is under test here is the file
 * handling and the adoption around it.
 */
const MAX_AUTO_RETRIES = 5;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;

type Row = Record<string, unknown> & {
  id: string;
  createdAt: number;
  uploadStatus: string;
  retryCount: number;
  lastAttemptAt?: number;
  lastError?: string;
  fitPath: string;
  streamsPath?: string;
  intervalsActivityId?: string;
  engineActivityId?: string;
};

const rows = new Map<string, Row>();

function due(row: Row, now: number): boolean {
  if (row.uploadStatus !== 'pending') return false;
  if (!row.lastAttemptAt) return true;
  return now - row.lastAttemptAt >= Math.min(BACKOFF_BASE_MS * 2 ** row.retryCount, BACKOFF_CAP_MS);
}

const mockEngine = {
  addRecording: (entry: Row) => {
    if (rows.has(entry.id)) return false;
    rows.set(entry.id, { ...entry });
    return true;
  },
  listRecordings: () => [...rows.values()].sort((a, b) => b.createdAt - a.createdAt),
  getRecording: (id: string) => rows.get(id) ?? null,
  attachRecordingEngineActivity: (id: string, engineActivityId: string) => {
    const row = rows.get(id);
    if (row) row.engineActivityId = engineActivityId;
  },
  markRecordingUploading: (id: string) => {
    const row = rows.get(id);
    if (row) row.uploadStatus = 'uploading';
  },
  markRecordingUploaded: (id: string, intervalsActivityId?: string) => {
    const row = rows.get(id);
    if (!row) return;
    row.uploadStatus = 'uploaded';
    row.intervalsActivityId = intervalsActivityId;
    row.lastError = undefined;
  },
  markRecordingUploadFailed: (id: string, error: string, nowMs: number) => {
    const row = rows.get(id);
    if (!row) return 0;
    row.retryCount += 1;
    row.lastAttemptAt = nowMs;
    row.lastError = error;
    row.uploadStatus = row.retryCount >= MAX_AUTO_RETRIES ? 'failed' : 'pending';
    return row.retryCount;
  },
  markRecordingRejected: (id: string, error: string, nowMs: number) => {
    const row = rows.get(id);
    if (!row) return;
    row.uploadStatus = 'failed';
    row.lastError = error;
    row.lastAttemptAt = nowMs;
  },
  markRecordingPermissionBlocked: (id: string, nowMs: number) => {
    const row = rows.get(id);
    if (!row) return;
    row.uploadStatus = 'permissionBlocked';
    row.lastAttemptAt = nowMs;
  },
  requeueRecording: (id: string) => {
    const row = rows.get(id);
    if (!row) return;
    row.uploadStatus = 'pending';
    row.retryCount = 0;
    row.lastAttemptAt = undefined;
    row.lastError = undefined;
  },
  clearRecordingPermissionBlocked: () => {
    for (const row of rows.values()) {
      if (row.uploadStatus !== 'permissionBlocked') continue;
      row.uploadStatus = 'pending';
      row.retryCount = 0;
      row.lastAttemptAt = undefined;
    }
  },
  demoteRecordingsToLocalOnly: () => {
    for (const row of rows.values()) {
      if (['pending', 'uploading', 'permissionBlocked'].includes(row.uploadStatus)) {
        row.uploadStatus = 'localOnly';
      }
    }
  },
  nextPendingRecording: (nowMs: number) =>
    [...rows.values()].sort((a, b) => a.createdAt - b.createdAt).find((r) => due(r, nowMs)) ?? null,
  deleteRecording: (id: string) => {
    const row = rows.get(id) ?? null;
    rows.delete(id);
    return row;
  },
  unuploadedRecordingCount: () =>
    [...rows.values()].filter((r) => r.uploadStatus !== 'uploaded').length,
  permissionBlockedRecordingCount: () =>
    [...rows.values()].filter((r) => r.uploadStatus === 'permissionBlocked').length,
  clearRecordings: () => rows.clear(),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

function makeBuffer(): ArrayBuffer {
  return new Uint8Array([0x0e, 0x10, 0x56, 0x45, 0x4c, 0x4f, 0x51]).buffer;
}

function makeStreams(): RecordingStreams {
  return {
    time: [0, 1],
    latlng: [
      [47.0, 8.0],
      [47.001, 8.001],
    ],
    altitude: [400, 401],
    heartrate: [],
    power: [],
    cadence: [],
    speed: [1, 1.2],
    distance: [0, 12],
  };
}

async function saveOne(
  overrides: Partial<Parameters<typeof saveRecording>[0]> = {}
): Promise<NonNullable<Awaited<ReturnType<typeof saveRecording>>>> {
  const entry = await saveRecording({
    fitBuffer: makeBuffer(),
    streams: makeStreams(),
    activityType: 'Ride',
    name: 'Morning Ride',
    startTime: 1_700_000_000_000,
    durationSeconds: 3600,
    distanceMeters: 25_000,
    uploadStatus: 'pending',
    ...overrides,
  });
  expect(entry).not.toBeNull();
  return entry!;
}

beforeEach(() => {
  mockStorage.clear();
  mockFileStore.clear();
  mockDirStore.clear();
  rows.clear();
});

describe('saveRecording', () => {
  it('persists FIT, streams sidecar, and index entry', async () => {
    const entry = await saveOne();
    expect(mockFileStore.has(entry.fitPath)).toBe(true);
    expect(entry.streamsPath && mockFileStore.has(entry.streamsPath)).toBe(true);

    const listed = await listRecordings();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Morning Ride');
    expect(listed[0].uploadStatus).toBe('pending');
  });

  it('round-trips FIT bytes and streams', async () => {
    const entry = await saveOne();
    const fit = await readRecordingFit(entry);
    expect(fit).not.toBeNull();
    expect(Array.from(new Uint8Array(fit!))).toEqual([0x0e, 0x10, 0x56, 0x45, 0x4c, 0x4f, 0x51]);

    const streams = await readRecordingStreams(entry);
    expect(streams?.latlng).toHaveLength(2);
  });

  it('respects localOnly status for auto-upload off', async () => {
    const entry = await saveOne({ uploadStatus: 'localOnly' });
    expect(entry.uploadStatus).toBe('localOnly');
    expect(await nextPendingUpload()).toBeNull();
  });
});

describe('status transitions', () => {
  it('marks uploaded and keeps the file', async () => {
    const entry = await saveOne();
    await markRecordingUploaded(entry.id, 'i12345');
    const updated = await getRecording(entry.id);
    expect(updated?.uploadStatus).toBe('uploaded');
    expect(updated?.intervalsActivityId).toBe('i12345');
    expect(mockFileStore.has(entry.fitPath)).toBe(true);
  });

  it('keeps pending through retriable failures, parks as failed after max, never deletes', async () => {
    const entry = await saveOne();
    for (let i = 0; i < 4; i++) {
      await markRecordingUploadFailed(entry.id, `boom ${i}`);
      expect((await getRecording(entry.id))?.uploadStatus).toBe('pending');
    }
    await markRecordingUploadFailed(entry.id, 'boom 5');
    const parked = await getRecording(entry.id);
    expect(parked?.uploadStatus).toBe('failed');
    expect(parked?.retryCount).toBe(5);
    expect(mockFileStore.has(entry.fitPath)).toBe(true);
  });

  it('rejection parks as failed immediately without deleting', async () => {
    const entry = await saveOne();
    await markRecordingRejected(entry.id, 'duplicate activity');
    const parked = await getRecording(entry.id);
    expect(parked?.uploadStatus).toBe('failed');
    expect(parked?.lastError).toBe('duplicate activity');
    expect(mockFileStore.has(entry.fitPath)).toBe(true);
  });

  it('requeue resets the retry state', async () => {
    const entry = await saveOne();
    await markRecordingRejected(entry.id, 'oops');
    await requeueRecording(entry.id);
    const updated = await getRecording(entry.id);
    expect(updated?.uploadStatus).toBe('pending');
    expect(updated?.retryCount).toBe(0);
    expect(updated?.lastError).toBeUndefined();
  });

  it('permission-blocked entries wait and unblock together', async () => {
    const a = await saveOne();
    const b = await saveOne({ name: 'Second' });
    await markRecordingPermissionBlocked(a.id);
    await markRecordingPermissionBlocked(b.id);
    expect(await getPermissionBlockedCount()).toBe(2);
    expect(await nextPendingUpload()).toBeNull();

    await clearPermissionBlocked();
    expect(await getPermissionBlockedCount()).toBe(0);
    expect((await nextPendingUpload())?.uploadStatus).toBe('pending');
  });
});

describe('backoff', () => {
  it('is immediately eligible before any attempt', async () => {
    const entry = await saveOne();
    expect(isRetryEligible(entry, Date.now())).toBe(true);
  });

  it('waits exponentially after failures', async () => {
    const entry = await saveOne();
    await markRecordingUploadFailed(entry.id, 'net down');
    const failedOnce = (await getRecording(entry.id))!;
    const attemptAt = failedOnce.lastAttemptAt!;
    // retryCount 1 → 60s delay
    expect(isRetryEligible(failedOnce, attemptAt + 30_000)).toBe(false);
    expect(isRetryEligible(failedOnce, attemptAt + 61_000)).toBe(true);
  });

  it('nextPendingUpload skips entries inside their backoff window', async () => {
    const entry = await saveOne();
    await markRecordingUploadFailed(entry.id, 'net down');
    expect(await nextPendingUpload(Date.now())).toBeNull();
    expect(await nextPendingUpload(Date.now() + 120_000)).not.toBeNull();
  });
});

describe('logout demotion', () => {
  it('demotes pending and blocked entries to localOnly, keeps uploaded', async () => {
    const a = await saveOne();
    const b = await saveOne({ name: 'Blocked' });
    const c = await saveOne({ name: 'Done' });
    await markRecordingPermissionBlocked(b.id);
    await markRecordingUploaded(c.id);

    await demotePendingToLocalOnly();

    expect((await getRecording(a.id))?.uploadStatus).toBe('localOnly');
    expect((await getRecording(b.id))?.uploadStatus).toBe('localOnly');
    expect((await getRecording(c.id))?.uploadStatus).toBe('uploaded');
    expect(mockFileStore.has(a.fitPath)).toBe(true);
  });
});

describe('deleteRecording', () => {
  it('removes the entry and its files', async () => {
    const entry = await saveOne();
    await deleteRecording(entry.id);
    expect(await getRecording(entry.id)).toBeNull();
    expect(mockFileStore.has(entry.fitPath)).toBe(false);
    expect(entry.streamsPath && mockFileStore.has(entry.streamsPath)).toBe(false);
  });
});

describe('counts', () => {
  it('counts everything not yet uploaded', async () => {
    const a = await saveOne();
    await saveOne({ name: 'Local', uploadStatus: 'localOnly' });
    const c = await saveOne({ name: 'Done' });
    await markRecordingUploaded(c.id);
    await markRecordingRejected(a.id, 'no');
    expect(await getUnuploadedCount()).toBe(2);
  });
});

describe('legacy migration', () => {
  it('adopts pending_uploads entries into the library', async () => {
    const legacyPath = '/mock/docs/pending_uploads/123.fit';
    mockFileStore.set(legacyPath, bufferToBase64(makeBuffer()));
    mockDirStore.add('/mock/docs/pending_uploads/');
    mockStorage.set(
      'veloq-upload-queue',
      JSON.stringify([
        {
          id: '123-abc',
          filePath: legacyPath,
          activityType: 'Run',
          name: 'Old Run',
          createdAt: 1_600_000_000_000,
          retryCount: 3,
          permissionBlocked: true,
        },
      ])
    );

    await migrateLegacyUploadQueue();

    const entries = await listRecordings();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('123-abc');
    expect(entries[0].uploadStatus).toBe('permissionBlocked');
    expect(mockFileStore.has('/mock/docs/recordings/123-abc.fit')).toBe(true);
    expect(mockFileStore.has(legacyPath)).toBe(false);
    expect(mockStorage.has('veloq-upload-queue')).toBe(false);
  });

  it('is a no-op without a legacy queue', async () => {
    await migrateLegacyUploadQueue();
    expect(await listRecordings()).toHaveLength(0);
  });

  it('does not duplicate entries when run twice', async () => {
    const legacyPath = '/mock/docs/pending_uploads/9.fit';
    mockFileStore.set(legacyPath, bufferToBase64(makeBuffer()));
    mockStorage.set(
      'veloq-upload-queue',
      JSON.stringify([
        {
          id: '9-x',
          filePath: legacyPath,
          activityType: 'Ride',
          name: 'Nine',
          createdAt: 1,
          retryCount: 0,
        },
      ])
    );
    await migrateLegacyUploadQueue();
    await migrateLegacyUploadQueue();
    expect(await listRecordings()).toHaveLength(1);
  });
});

describe('adopting the AsyncStorage index', () => {
  const stored = (entries: unknown[]) =>
    mockStorage.set('veloq-recording-library', JSON.stringify(entries));

  const legacyEntry = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    fitPath: `/mock/docs/recordings/${id}.fit`,
    streamsPath: `/mock/docs/recordings/${id}.streams.json`,
    activityType: 'Ride',
    name: `Ride ${id}`,
    startTime: 1_700_000_000_000,
    durationSeconds: 3600,
    distanceMeters: 25_000,
    createdAt: 1_700_000_000_000,
    uploadStatus: 'pending',
    retryCount: 2,
    lastAttemptAt: 1_700_000_100_000,
    lastError: 'network',
    ...overrides,
  });

  it('carries every entry over with its retry state intact', async () => {
    stored([legacyEntry('a'), legacyEntry('b', { uploadStatus: 'uploaded', retryCount: 0 })]);

    expect(await adoptAsyncStorageIndex()).toBe(2);

    const listed = await listRecordings();
    expect(listed.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(listed.find((e) => e.id === 'a')).toMatchObject({
      retryCount: 2,
      lastAttemptAt: 1_700_000_100_000,
      lastError: 'network',
      streamsPath: '/mock/docs/recordings/a.streams.json',
    });
  });

  it('removes the key so the next launch does not adopt again', async () => {
    stored([legacyEntry('a')]);
    await adoptAsyncStorageIndex();

    expect(mockStorage.has('veloq-recording-library')).toBe(false);
    expect(await adoptAsyncStorageIndex()).toBe(0);
    expect(await listRecordings()).toHaveLength(1);
  });

  it('takes the rest when a run is interrupted before the key is removed', async () => {
    stored([legacyEntry('a'), legacyEntry('b')]);
    await adoptAsyncStorageIndex();
    stored([legacyEntry('a'), legacyEntry('b'), legacyEntry('c')]);

    expect(await adoptAsyncStorageIndex()).toBe(1);
    expect(await listRecordings()).toHaveLength(3);
  });

  it('skips an entry with no id or no FIT path rather than writing a row nothing can find', async () => {
    stored([legacyEntry('a'), { name: 'nameless' }, legacyEntry('b', { fitPath: undefined })]);

    expect(await adoptAsyncStorageIndex()).toBe(1);
    expect((await listRecordings()).map((e) => e.id)).toEqual(['a']);
  });

  it('is a no-op with no stored index, and clears a key that is not a list', async () => {
    expect(await adoptAsyncStorageIndex()).toBe(0);

    mockStorage.set('veloq-recording-library', '{"not":"a list"}');
    expect(await adoptAsyncStorageIndex()).toBe(0);
    expect(mockStorage.has('veloq-recording-library')).toBe(false);
  });

  it('takes what the legacy upload queue migrated, when it runs after it', async () => {
    mockFileStore.set('/mock/docs/pending_uploads/q1.fit', 'RklU');
    mockStorage.set(
      'veloq-upload-queue',
      JSON.stringify([
        {
          id: 'q1',
          filePath: '/mock/docs/pending_uploads/q1.fit',
          activityType: 'Run',
          name: 'Queued run',
          createdAt: 1_699_000_000_000,
          retryCount: 0,
        },
      ])
    );

    await migrateLegacyUploadQueue();
    await adoptAsyncStorageIndex();

    const listed = await listRecordings();
    expect(listed.map((e) => e.id)).toEqual(['q1']);
    expect(listed[0].uploadStatus).toBe('pending');
  });
});
