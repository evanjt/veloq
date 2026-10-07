/**
 * Tests for the recordings library storage.
 *
 * Covers: saveRecording (FIT + index, with the review's notes and effort),
 * listing order, status transitions (uploaded / retriable failure / rejection /
 * permission-blocked / requeue), the never-delete guarantee on exhausted
 * retries, exponential backoff eligibility, user deletion, counts, and legacy
 * pending_uploads migration.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { RecordingTransition } from 'veloqrs/src/delegates/recordings';
import {
  saveRecording,
  listRecordings,
  getRecording,
  clearPermissionBlocked,
  transitionRecording,
  markRecordingRpeSent,
  deleteRecording,
  getVisibleUnuploadedCount,
  listVisibleRecordings,
  getVisibleRecording,
  holdsRecordingStartingIn,
  migrateLegacyUploadQueue,
  adoptAsyncStorageIndex,
  adoptOwnerlessRecordings,
  bufferToBase64,
  base64ToBuffer,
} from '@/features/recording/lib/storage/recordingLibrary';

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
  ...jest.requireActual('expo-file-system/legacy'),
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
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!mockFileStore.has(from)) throw new Error('ENOENT');
    mockFileStore.set(to, mockFileStore.get(from)!);
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

/** An athlete's own rows and the unstamped ones; nobody signed in sees only the latter. */
function visibleTo(row: Row, athleteId?: string): boolean {
  return row.athleteId == null || row.athleteId === athleteId;
}

const INSTALL = 4;

const mockEngine = {
  ready: true,
  addRecording: (entry: Row) => {
    if (typeof entry.kind !== 'string') throw new Error('Recording kind is required');
    if (!mockEngine.ready || rows.has(entry.id)) return false;
    rows.set(entry.id, { ...entry });
    return true;
  },
  listRecordings: () => [...rows.values()].sort((a, b) => b.createdAt - a.createdAt),
  getRecording: (id: string) => rows.get(id) ?? null,
  attachRecordingEngineActivity: (id: string, engineActivityId: string) => {
    const row = rows.get(id);
    if (row) row.engineActivityId = engineActivityId;
  },
  markRecordingReconciled: (id: string) => {
    const row = rows.get(id);
    if (row) row.engineReconciled = true;
  },
  engineInstall: () => INSTALL,
  transitionRecording: (id: string, transition: RecordingTransition, nowMs: number) => {
    const row = rows.get(id);
    if (!row) {
      return { applied: false, refusal: 'NoRecording', retryCount: 0, install: INSTALL };
    }
    const found = row.uploadStatus;
    const refuse = () => ({
      applied: false,
      refusal: 'IllegalTransition',
      found,
      retryCount: row.retryCount,
      install: INSTALL,
    });
    switch (transition.kind) {
      case 'begin':
        row.uploadStatus = 'uploading';
        break;
      case 'requeue':
        if (found === 'uploaded' || found === 'uploading') return refuse();
        row.uploadStatus = 'pending';
        row.retryCount = 0;
        delete row.lastAttemptAt;
        delete row.lastError;
        break;
      case 'uploaded':
        row.uploadStatus = 'uploaded';
        if (transition.intervalsActivityId === undefined) delete row.intervalsActivityId;
        else row.intervalsActivityId = transition.intervalsActivityId;
        delete row.lastError;
        break;
      case 'failed':
        row.retryCount += 1;
        row.lastAttemptAt = nowMs;
        row.lastError = transition.error;
        row.uploadStatus = row.retryCount >= MAX_AUTO_RETRIES ? 'failed' : 'pending';
        break;
      case 'rejected':
        row.uploadStatus = 'failed';
        row.lastError = transition.error;
        row.lastAttemptAt = nowMs;
        break;
      case 'permissionBlocked':
        row.uploadStatus = 'permissionBlocked';
        row.lastAttemptAt = nowMs;
        break;
      default:
        return refuse();
    }
    return { applied: true, found, retryCount: row.retryCount, install: INSTALL };
  },
  stampOwnerlessRecordings: (athleteId: string) => {
    for (const row of rows.values()) if (row.athleteId == null) row.athleteId = athleteId;
  },
  clearRecordingPermissionBlocked: (athleteId?: string) => {
    for (const row of rows.values()) {
      if (row.uploadStatus !== 'permissionBlocked' || row.athleteId !== athleteId) continue;
      row.uploadStatus = 'pending';
      row.retryCount = 0;
      delete row.lastAttemptAt;
    }
  },
  markRecordingRpeSent: (id: string) => {
    const row = rows.get(id);
    if (row) row.rpeSent = true;
  },
  listVisibleRecordings: (athleteId?: string) =>
    mockEngine.listRecordings().filter((r) => visibleTo(r, athleteId)),
  getVisibleRecording: (id: string, athleteId?: string) => {
    const row = rows.get(id);
    return row && visibleTo(row, athleteId) ? row : null;
  },
  deleteOwnRecording: (id: string, athleteId?: string) => {
    const row = mockEngine.getVisibleRecording(id, athleteId);
    if (row) rows.delete(id);
    return row;
  },
  unuploadedVisibleRecordingCount: (athleteId?: string) =>
    [...rows.values()].filter((r) => r.uploadStatus !== 'uploaded' && visibleTo(r, athleteId))
      .length,
  clearRecordings: () => rows.clear(),
};

const markRecordingUploaded = (id: string, intervalsActivityId?: string) =>
  transitionRecording(id, { kind: 'uploaded', install: INSTALL, intervalsActivityId });
const markRecordingUploadFailed = (id: string, error: string) =>
  transitionRecording(id, { kind: 'failed', install: INSTALL, error });
const markRecordingRejected = (id: string, error: string) =>
  transitionRecording(id, { kind: 'rejected', install: INSTALL, error });
const markRecordingPermissionBlocked = (id: string) =>
  transitionRecording(id, { kind: 'permissionBlocked', install: INSTALL });
const requeueRecording = async (id: string) =>
  (await transitionRecording(id, { kind: 'requeue' })).applied;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

let mockSignedInAthlete: string | null = 'i296629';

jest.mock('@/shared/app/AuthStore', () => ({
  getStoredCredentials: () => ({
    apiKey: null,
    accessToken: 'token',
    athleteId: mockSignedInAthlete,
    authMethod: 'oauth',
  }),
}));

function makeBuffer(): ArrayBuffer {
  return new Uint8Array([0x0e, 0x10, 0x56, 0x45, 0x4c, 0x4f, 0x51]).buffer;
}

async function saveOne(
  overrides: Partial<Parameters<typeof saveRecording>[0]> = {}
): Promise<NonNullable<Awaited<ReturnType<typeof saveRecording>>>> {
  const entry = await saveRecording({
    fitBuffer: makeBuffer(),
    activityType: 'Ride',
    name: 'Morning Ride',
    startTime: 1_700_000_000_000,
    durationSeconds: 3600,
    distanceMeters: 25_000,
    uploadStatus: 'pending',
    athleteId: 'i296629',
    ...overrides,
  });
  expect(entry).not.toBeNull();
  return entry!;
}

beforeEach(() => {
  mockEngine.ready = true;
  mockStorage.clear();
  mockFileStore.clear();
  mockDirStore.clear();
  rows.clear();
  mockSignedInAthlete = 'i296629';
});

describe('saveRecording', () => {
  it('persists the FIT and the index entry, and no streams sidecar', async () => {
    const entry = await saveOne();
    expect(mockFileStore.has(entry.fitPath)).toBe(true);
    expect(entry.streamsPath).toBeUndefined();
    expect([...mockFileStore.keys()].filter((path) => path.endsWith('.streams.json'))).toEqual([]);

    const listed = await listRecordings();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Morning Ride');
    expect(listed[0].uploadStatus).toBe('pending');
  });

  it('writes the FIT bytes the engine will stream to the path the row names', async () => {
    const entry = await saveOne();
    const written = mockFileStore.get(entry.fitPath);
    expect(written).toBeDefined();
    expect(Array.from(new Uint8Array(base64ToBuffer(written!)))).toEqual([
      0x0e, 0x10, 0x56, 0x45, 0x4c, 0x4f, 0x51,
    ]);
  });

  it("keeps the review's notes and effort on the row, owed until sent", async () => {
    const entry = await saveOne({ notes: 'legs heavy', rpe: 8 });
    expect(rows.get(entry.id)).toMatchObject({ notes: 'legs heavy', rpe: 8, rpeSent: false });
    expect(await getRecording(entry.id)).toMatchObject({ notes: 'legs heavy', rpe: 8 });

    await markRecordingRpeSent(entry.id);
    expect(rows.get(entry.id)?.rpeSent).toBe(true);
  });

  it('stores no effort when the slider was never moved, and no empty notes', async () => {
    const entry = await saveOne({ notes: '', rpe: undefined });
    expect(rows.get(entry.id)?.rpe).toBeUndefined();
    expect(rows.get(entry.id)?.notes).toBeUndefined();
  });

  it('stamps the athlete who recorded it', async () => {
    const entry = await saveOne();
    expect(entry.athleteId).toBe('i296629');
    expect(rows.get(entry.id)?.athleteId).toBe('i296629');
    expect(entry.uploadStatus).toBe('pending');
  });

  it('stamps the ride owner when another athlete signed in while the save was in flight', async () => {
    mockSignedInAthlete = 'i100001';
    const entry = await saveOne({ athleteId: 'i296629' });
    expect(entry.athleteId).toBe('i296629');
    expect(rows.get(entry.id)?.athleteId).toBe('i296629');
  });

  it("holds the ride out of the signed-in athlete's queue when it is not theirs", async () => {
    mockSignedInAthlete = 'i100001';
    const entry = await saveOne({ athleteId: 'i296629' });
    expect(entry.uploadStatus).toBe('localOnly');
    expect(rows.get(entry.id)?.uploadStatus).toBe('localOnly');
  });

  it('stamps the owner and keeps the ride queued when nobody is signed in', async () => {
    mockSignedInAthlete = null;
    const entry = await saveOne({ athleteId: 'i296629' });
    expect(entry.athleteId).toBe('i296629');
    expect(entry.uploadStatus).toBe('pending');
  });

  it('stamps a local-only recording too, so a later requeue can tell whose it is', async () => {
    const entry = await saveOne({ uploadStatus: 'localOnly' });
    expect(entry.athleteId).toBe('i296629');
  });

  it('respects localOnly status for auto-upload off', async () => {
    const entry = await saveOne({ uploadStatus: 'localOnly' });
    expect(entry.uploadStatus).toBe('localOnly');
    expect(rows.get(entry.id)?.uploadStatus).toBe('localOnly');
  });
});

describe('holdsRecordingStartingIn', () => {
  const START = 1_700_000_000_000;

  it('finds a recorded ride starting inside the window, its ends included', async () => {
    await saveOne({ startTime: START + 60_000 });
    expect(holdsRecordingStartingIn(START, START + 3_600_000)).toBe(true);
    expect(holdsRecordingStartingIn(START + 60_000, START + 60_000)).toBe(true);
  });

  it('finds nothing for a ride starting outside the window', async () => {
    await saveOne({ startTime: START - 1 });
    await saveOne({ startTime: START + 3_600_001 });
    expect(holdsRecordingStartingIn(START, START + 3_600_000)).toBe(false);
  });

  it('does not count a manual entry', async () => {
    await saveOne({
      fitBuffer: undefined,
      manualBody: { type: 'Yoga', name: 'Yoga', start_date_local: '', elapsed_time: 600 },
      startTime: START + 60_000,
    });
    expect(holdsRecordingStartingIn(START, START + 3_600_000)).toBe(false);
  });

  it('finds nothing in an empty library', () => {
    expect(holdsRecordingStartingIn(START, START + 3_600_000)).toBe(false);
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

  it('requeue reports the engine refusing a ride that already landed', async () => {
    const entry = await saveOne();
    await markRecordingUploaded(entry.id, 'i77');

    expect(await requeueRecording(entry.id)).toBe(false);
    expect((await getRecording(entry.id))?.uploadStatus).toBe('uploaded');
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

  it("an upgrade requeues the upgrading athlete's blocked entries and nobody else's", async () => {
    const a = await saveOne();
    const b = await saveOne({ name: 'Second' });
    const theirs = await saveOne({ name: 'Theirs', athleteId: 'i100001' });
    for (const entry of [a, b, theirs]) await markRecordingPermissionBlocked(entry.id);
    for (const entry of [a, b, theirs])
      expect((await getRecording(entry.id))?.uploadStatus).toBe('permissionBlocked');

    await clearPermissionBlocked('i296629');
    expect((await getRecording(a.id))?.uploadStatus).toBe('pending');
    expect((await getRecording(b.id))?.uploadStatus).toBe('pending');
    expect((await getRecording(theirs.id))?.uploadStatus).toBe('permissionBlocked');
  });
});

describe('deleteRecording', () => {
  it('removes the entry and its files', async () => {
    const entry = await saveOne();
    await deleteRecording(entry.id);
    expect(await getRecording(entry.id)).toBeNull();
    expect(mockFileStore.has(entry.fitPath)).toBe(false);
  });

  it('removes a streams sidecar an earlier build left beside the FIT', async () => {
    const entry = await saveOne();
    const sidecar = entry.fitPath.replace(/\.fit$/, '.streams.json');
    mockFileStore.set(sidecar, '{}');
    rows.get(entry.id)!.streamsPath = sidecar;
    await deleteRecording(entry.id);
    expect(mockFileStore.has(sidecar)).toBe(false);
  });
});

describe("another athlete's held rides", () => {
  it('lists, opens and counts only what the signed-in athlete may see', async () => {
    const mine = await saveOne({ name: 'Mine', athleteId: 'i100001' });
    const theirs = await saveOne({ name: 'Theirs', athleteId: 'i296629' });
    mockSignedInAthlete = 'i100001';

    expect((await listVisibleRecordings()).map((e) => e.id)).toEqual([mine.id]);
    expect(await getVisibleRecording(theirs.id)).toBeNull();
    expect(await getVisibleRecording(mine.id)).not.toBeNull();
    expect(await getVisibleUnuploadedCount()).toBe(1);
  });

  it('leaves the row and its FIT when another athlete is signed in', async () => {
    const theirs = await saveOne({ athleteId: 'i296629' });
    mockSignedInAthlete = 'i100001';
    await deleteRecording(theirs.id);
    expect(rows.has(theirs.id)).toBe(true);
    expect(mockFileStore.has(theirs.fitPath)).toBe(true);
  });

  it('shows nothing stamped to anyone while signed out', async () => {
    await saveOne({ athleteId: 'i296629' });
    mockSignedInAthlete = null;
    expect(await listVisibleRecordings()).toEqual([]);
    expect(await getVisibleUnuploadedCount()).toBe(0);
  });
});

describe('counts', () => {
  it('counts everything not yet uploaded', async () => {
    const a = await saveOne();
    await saveOne({ name: 'Local', uploadStatus: 'localOnly' });
    const c = await saveOne({ name: 'Done' });
    await markRecordingUploaded(c.id);
    await markRecordingRejected(a.id, 'no');
    expect(await getVisibleUnuploadedCount()).toBe(2);
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

  it('settles an entry whose FIT is gone so the queue still clears', async () => {
    const present = '/mock/docs/pending_uploads/here.fit';
    mockFileStore.set(present, 'RklU');
    mockDirStore.add('/mock/docs/pending_uploads/');
    mockStorage.set(
      'veloq-upload-queue',
      JSON.stringify([
        {
          id: 'here',
          filePath: present,
          activityType: 'Ride',
          name: 'Here',
          createdAt: 1,
          retryCount: 0,
        },
        {
          id: 'gone',
          filePath: '/mock/docs/pending_uploads/gone.fit',
          activityType: 'Ride',
          name: 'Gone',
          createdAt: 2,
          retryCount: 0,
        },
      ])
    );

    await migrateLegacyUploadQueue();

    expect(rows.has('here')).toBe(true);
    expect(rows.has('gone')).toBe(false);
    expect(mockStorage.has('veloq-upload-queue')).toBe(false);
    expect(mockDirStore.has('/mock/docs/pending_uploads/')).toBe(false);
  });

  it('keeps the queue and the source when the copy fails', async () => {
    const filePath = '/mock/docs/pending_uploads/copy.fit';
    mockFileStore.set(filePath, 'RklU');
    mockDirStore.add('/mock/docs/pending_uploads/');
    mockStorage.set(
      'veloq-upload-queue',
      JSON.stringify([
        { id: 'copy', filePath, activityType: 'Ride', name: 'Copy', createdAt: 1, retryCount: 0 },
      ])
    );
    (FileSystem.copyAsync as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await migrateLegacyUploadQueue();

    expect(rows.has('copy')).toBe(false);
    expect(mockStorage.has('veloq-upload-queue')).toBe(true);
    expect(mockFileStore.get(filePath)).toBe('RklU');
    expect(mockDirStore.has('/mock/docs/pending_uploads/')).toBe(true);
  });

  it('clears the queue when every entry is already in the library', async () => {
    const filePath = '/mock/docs/pending_uploads/kept.fit';
    mockFileStore.set(filePath, 'RklU');
    mockDirStore.add('/mock/docs/pending_uploads/');
    const queue = JSON.stringify([
      { id: 'kept', filePath, activityType: 'Ride', name: 'Kept', createdAt: 1, retryCount: 0 },
    ]);
    mockStorage.set('veloq-upload-queue', queue);
    const insert = jest.spyOn(mockEngine, 'addRecording');
    await migrateLegacyUploadQueue();
    expect(rows.has('kept')).toBe(true);
    insert.mockClear();

    // The key survives a removal that lost the race with a kill.
    mockStorage.set('veloq-upload-queue', queue);
    mockDirStore.add('/mock/docs/pending_uploads/');
    await migrateLegacyUploadQueue();

    expect(insert).not.toHaveBeenCalled();
    expect(rows.size).toBe(1);
    expect(mockStorage.has('veloq-upload-queue')).toBe(false);
    expect(mockDirStore.has('/mock/docs/pending_uploads/')).toBe(false);
    insert.mockRestore();
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
      kind: 'fit',
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
    expect(mockStorage.has('veloq-recording-library')).toBe(true);
  });

  it('continues after a failed row and retires the key only after a successful retry', async () => {
    stored([legacyEntry('a'), legacyEntry('b'), legacyEntry('c')]);
    const insert = jest.spyOn(mockEngine, 'addRecording');
    insert.mockImplementationOnce((entry) => {
      rows.set(entry.id, { ...entry });
      return true;
    });
    insert.mockImplementationOnce(() => {
      throw new Error('write failed');
    });

    expect(await adoptAsyncStorageIndex()).toBe(2);
    expect([...rows.keys()]).toEqual(['a', 'c']);
    expect(mockStorage.has('veloq-recording-library')).toBe(true);
    insert.mockRestore();

    expect(await adoptAsyncStorageIndex()).toBe(1);
    expect([...rows.keys()]).toEqual(['a', 'c', 'b']);
    expect(mockStorage.has('veloq-recording-library')).toBe(false);
  });

  it('keeps the index when an open engine declines a missing row', async () => {
    stored([legacyEntry('a')]);
    const insert = jest.spyOn(mockEngine, 'addRecording').mockReturnValueOnce(false);

    expect(await adoptAsyncStorageIndex()).toBe(0);
    expect(rows.has('a')).toBe(false);
    expect(mockStorage.has('veloq-recording-library')).toBe(true);

    expect(await adoptAsyncStorageIndex()).toBe(1);
    expect(rows.has('a')).toBe(true);
    expect(mockStorage.has('veloq-recording-library')).toBe(false);
    insert.mockRestore();
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

/**
 * Scenario: a five-hour ride's FIT file is encoded for the upload queue.
 *
 * Expected behaviour: the same bytes come back out, whatever the length, and
 * a chunk boundary is not a place where a byte can go missing.
 */
describe('adoptOwnerlessRecordings', () => {
  const legacyRide = (id: string) => ({
    id,
    fitPath: `/mock/docs/recordings/${id}.fit`,
    activityType: 'Ride',
    name: `Ride ${id}`,
    startTime: 1_700_000_000_000,
    durationSeconds: 3600,
    distanceMeters: 25_000,
    createdAt: 1_700_000_000_000,
    uploadStatus: 'pending',
    retryCount: 0,
  });
  const storeIndex = (ids: string[]) =>
    mockStorage.set('veloq-recording-library', JSON.stringify(ids.map(legacyRide)));
  const athletesOf = () => [...rows.values()].map((row) => row.athleteId);

  it("stamps an upgrader's legacy rides with the library's athlete on the first launch", async () => {
    storeIndex(['a', 'b']);

    await adoptOwnerlessRecordings(async () => 'iA');

    expect(athletesOf()).toEqual(['iA', 'iA']);
    expect(mockStorage.has('veloq-recording-library')).toBe(false);
  });

  it('stamps nothing at a later launch, when the library is named for someone else', async () => {
    storeIndex(['a']);
    await adoptOwnerlessRecordings(async () => 'iA');
    storeIndex(['a', 'b']);

    await adoptOwnerlessRecordings(async () => 'iB');

    expect(rows.get('a')?.athleteId).toBe('iA');
    expect(rows.get('b')).toBeUndefined();
  });

  it('leaves rides unstamped and settles when no athlete is cached', async () => {
    storeIndex(['a']);

    await adoptOwnerlessRecordings(async () => null);
    await adoptOwnerlessRecordings(async () => 'iB');

    expect(athletesOf()).toEqual([undefined]);
  });

  it('retries on the next launch when the legacy index is left behind', async () => {
    storeIndex(['a', 'b']);
    const insert = jest.spyOn(mockEngine, 'addRecording');
    insert.mockImplementationOnce((entry) => {
      rows.set(entry.id, { ...entry });
      return true;
    });
    insert.mockImplementationOnce(() => {
      throw new Error('write failed');
    });

    await adoptOwnerlessRecordings(async () => 'iA');
    expect(mockStorage.has('veloq-recording-library')).toBe(true);
    insert.mockRestore();

    await adoptOwnerlessRecordings(async () => 'iA');
    expect(athletesOf()).toEqual(['iA', 'iA']);
    expect(mockStorage.has('veloq-recording-library')).toBe(false);
  });

  it('stamps nothing once an account change has settled the adoptions', async () => {
    const {
      settleOwnerlessAdoptions,
    } = require('@/features/recording/lib/storage/recordingBackup');
    storeIndex(['a']);
    await settleOwnerlessAdoptions();

    await adoptOwnerlessRecordings(async () => 'iA');

    expect(rows.size).toBe(0);
  });
});

describe('bufferToBase64', () => {
  const roundTrip = (bytes: Uint8Array) =>
    new Uint8Array(base64ToBuffer(bufferToBase64(bytes.buffer as ArrayBuffer)));

  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);

    expect(roundTrip(bytes)).toEqual(bytes);
  });

  it('round-trips nothing at all', () => {
    expect(bufferToBase64(new ArrayBuffer(0))).toBe('');
    expect(roundTrip(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });

  it.each([8191, 8192, 8193, 16_384, 16_385])(
    'round-trips %i bytes, which crosses a chunk boundary',
    (length) => {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 0xff);

      expect(roundTrip(bytes)).toEqual(bytes);
    }
  );

  it('encodes a length that is not a multiple of three the same way', () => {
    // Base64 pads in threes, so the tail is where a chunked encoder goes wrong.
    for (const length of [1, 2, 3, 4, 5]) {
      const bytes = Uint8Array.from({ length }, (_, i) => i + 1);
      expect(roundTrip(bytes)).toEqual(bytes);
    }
  });
});

describe('closed engine persistence', () => {
  it('refuses a saved recording while the engine is closed', async () => {
    mockEngine.ready = false;
    expect(
      await saveRecording({
        fitBuffer: makeBuffer(),
        activityType: 'Ride',
        name: 'Closed',
        startTime: 1,
        durationSeconds: 1,
        distanceMeters: 1,
        uploadStatus: 'pending',
        athleteId: 'i296629',
      })
    ).toBeNull();
    expect(rows.size).toBe(0);
  });

  it('retains the index until a ready pass inserts or finds every entry', async () => {
    const entry = await saveOne();
    const second = { ...entry, id: 'second' };
    mockStorage.set('veloq-recording-library', JSON.stringify([entry, second]));
    mockEngine.ready = false;
    expect(await adoptAsyncStorageIndex()).toBe(0);
    expect(mockStorage.has('veloq-recording-library')).toBe(true);
    mockEngine.ready = true;
    expect(await adoptAsyncStorageIndex()).toBe(1);
    expect(rows.size).toBe(2);
    expect(mockStorage.has('veloq-recording-library')).toBe(false);
    expect(await adoptAsyncStorageIndex()).toBe(0);
  });

  it('retains the queue and files while closed and retries once ready', async () => {
    const filePath = '/mock/docs/pending_uploads/closed.fit';
    mockFileStore.set(filePath, 'RklU');
    mockDirStore.add('/mock/docs/pending_uploads/');
    mockStorage.set(
      'veloq-upload-queue',
      JSON.stringify([
        {
          id: 'closed',
          filePath,
          activityType: 'Ride',
          name: 'Closed',
          createdAt: 1,
          retryCount: 0,
        },
      ])
    );
    mockEngine.ready = false;
    await migrateLegacyUploadQueue();
    expect(mockStorage.has('veloq-upload-queue')).toBe(true);
    expect(mockFileStore.has(filePath)).toBe(true);
    expect(mockDirStore.has('/mock/docs/pending_uploads/')).toBe(true);
    mockEngine.ready = true;
    await migrateLegacyUploadQueue();
    expect(rows.has('closed')).toBe(true);
    expect(mockStorage.has('veloq-upload-queue')).toBe(false);
    await migrateLegacyUploadQueue();
    expect(rows.size).toBe(1);
  });
});

it('retains a failed queue entry and adopts it on a second pass without losing FIT bytes', async () => {
  const filePath = '/mock/docs/pending_uploads/retry.fit';
  mockFileStore.set(filePath, 'RklU');
  mockStorage.set(
    'veloq-upload-queue',
    JSON.stringify([
      { id: 'retry', filePath, activityType: 'Ride', name: 'Retry', createdAt: 1, retryCount: 0 },
    ])
  );
  const insert = jest.spyOn(mockEngine, 'addRecording').mockImplementationOnce(() => {
    throw new Error('write failed');
  });
  await migrateLegacyUploadQueue();
  expect(mockStorage.has('veloq-upload-queue')).toBe(true);
  expect(mockFileStore.get(filePath)).toBe('RklU');
  expect(mockFileStore.get('/mock/docs/recordings/retry.fit')).toBe('RklU');
  await migrateLegacyUploadQueue();
  expect(rows.has('retry')).toBe(true);
  expect(mockStorage.has('veloq-upload-queue')).toBe(false);
  expect(mockFileStore.get('/mock/docs/recordings/retry.fit')).toBe('RklU');
  insert.mockRestore();
});

it('retains the index after a failed insert and finds the successful entries on retry', async () => {
  const entry = await saveOne();
  mockStorage.set('veloq-recording-library', JSON.stringify([entry, { ...entry, id: 'retry' }]));
  const insert = jest
    .spyOn(mockEngine, 'addRecording')
    .mockImplementationOnce(() => false)
    .mockImplementationOnce(() => {
      throw new Error('write failed');
    });
  expect(await adoptAsyncStorageIndex()).toBe(0);
  expect(mockStorage.has('veloq-recording-library')).toBe(true);
  expect(await adoptAsyncStorageIndex()).toBe(1);
  expect(rows.size).toBe(2);
  expect(mockStorage.has('veloq-recording-library')).toBe(false);
  insert.mockRestore();
});
