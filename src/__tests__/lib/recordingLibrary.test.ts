/**
 * Tests for the recordings library storage.
 *
 * Covers: saveRecording (FIT + index, with the review's notes and effort),
 * listing order, the requeue of permission-blocked entries after an upgrade,
 * user deletion, counts, and legacy pending_uploads migration.
 */

import * as FileSystem from 'expo-file-system/legacy';
import {
  saveRecording,
  listRecordings,
  getRecording,
  clearPermissionBlocked,
  deleteRecording,
  getVisibleUnuploadedCount,
  listVisibleRecordings,
  getVisibleRecording,
  holdsRecordingStartingIn,
  migrateLegacyUploadQueue,
  adoptOwnerlessRecordings,
  recordingFitExists,
} from '@/features/recording/lib/storage/recordingLibrary';
import { engineErrorTag } from '@/shared/native/engineError';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);

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

const mockFileStore = new Map<string, string | Uint8Array>();
const mockDirStore = new Set<string>();
const mockFileWrite = jest.fn((path: string, content: Uint8Array) => {
  mockFileStore.set(path, content);
});

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((path: string) => ({
    write: (content: Uint8Array) => mockFileWrite(path, content),
  })),
}));

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
    return mockFileStore.get(path)! as string;
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
  provisionalActivityId: (recordingId: string) => `local-recording-${recordingId}`,
  attachRecordingEngineActivity: (id: string, engineActivityId: string) => {
    const row = rows.get(id);
    if (row) row.engineActivityId = engineActivityId;
  },
  engineInstall: () => INSTALL,
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
};

const setUploadStatus = (id: string, uploadStatus: string) => {
  const row = rows.get(id);
  if (row) row.uploadStatus = uploadStatus;
};

let mockEngineOpen = true;

jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => true,
  getEngine: () => (mockEngineOpen ? mockEngine : null),
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
  mockEngineOpen = true;
  mockEngine.ready = true;
  mockStorage.clear();
  mockFileStore.clear();
  mockDirStore.clear();
  mockFileWrite.mockClear();
  mockFileWrite.mockImplementation((path: string, content: Uint8Array) => {
    mockFileStore.set(path, content);
  });
  rows.clear();
  mockSignedInAthlete = 'i296629';
});

describe('saveRecording', () => {
  /**
   * Scenario: auto-upload is on and the upload lands before the save returns.
   * Expected behaviour: the row is inserted already carrying its engine key,
   * so the landing sweep finds the key and waits for the provisional row
   * instead of deleting the ride and leaving the server copy to duplicate it.
   */
  it('inserts the row with the engine key it will be written under', async () => {
    const entry = await saveOne();
    expect(rows.get(entry.id)?.engineActivityId).toBe(`local-recording-${entry.id}`);
    expect(entry.engineActivityId).toBe(`local-recording-${entry.id}`);
  });

  it('inserts a manual entry with its engine key too', async () => {
    const entry = await saveOne({ fitBuffer: undefined, manualBody: { type: 'Ride' } as never });
    expect(rows.get(entry.id)?.engineActivityId).toBe(`local-recording-${entry.id}`);
  });

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
    expect(written).toBeInstanceOf(Uint8Array);
    expect(Array.from(written as Uint8Array)).toEqual([0x0e, 0x10, 0x56, 0x45, 0x4c, 0x4f, 0x51]);
    expect(
      jest
        .mocked(FileSystem.writeAsStringAsync)
        .mock.calls.filter(([path]) => path === entry.fitPath)
    ).toEqual([]);
  });

  it('leaves no index row when writing the FIT throws', async () => {
    mockFileWrite.mockImplementationOnce(() => {
      throw new Error('Disk full');
    });

    expect(
      await saveRecording({
        fitBuffer: makeBuffer(),
        activityType: 'Ride',
        name: 'Morning Ride',
        startTime: 1_700_000_000_000,
        durationSeconds: 3600,
        distanceMeters: 25_000,
        uploadStatus: 'pending',
        athleteId: 'i296629',
      })
    ).toBeNull();
    expect(rows.size).toBe(0);
  });

  /**
   * Scenario: the files are written and the engine then refuses the row.
   * Expected behaviour: no file is left on disk that no row names.
   */
  it('removes the FIT and the manual body when the row insert throws', async () => {
    jest.spyOn(mockEngine, 'addRecording').mockImplementationOnce(() => {
      throw new Error('Database locked');
    });
    expect(
      await saveRecording({
        fitBuffer: makeBuffer(),
        manualBody: { type: 'Ride' } as never,
        activityType: 'Ride',
        name: 'Morning Ride',
        startTime: 1_700_000_000_000,
        durationSeconds: 3600,
        distanceMeters: 25_000,
        uploadStatus: 'pending',
        athleteId: 'athlete-a',
      })
    ).toBeNull();
    expect(rows.size).toBe(0);
    expect([...mockFileStore.keys()].filter((path) => path.includes('/recordings/'))).toEqual([]);
  });

  it('removes the FIT when the manual body cannot be written', async () => {
    jest.mocked(FileSystem.writeAsStringAsync).mockRejectedValueOnce(new Error('Disk full'));
    expect(
      await saveRecording({
        fitBuffer: makeBuffer(),
        manualBody: { type: 'Ride' } as never,
        activityType: 'Ride',
        name: 'Morning Ride',
        startTime: 1_700_000_000_000,
        durationSeconds: 3600,
        distanceMeters: 25_000,
        uploadStatus: 'pending',
        athleteId: 'athlete-a',
      })
    ).toBeNull();
    expect([...mockFileStore.keys()].filter((path) => path.includes('/recordings/'))).toEqual([]);
  });

  it('removes the body file when the index insert throws on a manual entry', async () => {
    jest.spyOn(mockEngine, 'addRecording').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });

    expect(
      await saveRecording({
        manualBody: { type: 'Ride' } as never,
        activityType: 'Ride',
        name: 'Manual',
        startTime: 1_700_000_000_000,
        durationSeconds: 3600,
        distanceMeters: 0,
        uploadStatus: 'pending',
        athleteId: 'i296629',
      })
    ).toBeNull();
    expect([...mockFileStore.keys()].filter((path) => path.endsWith('.manual.json'))).toEqual([]);
  });

  it("keeps the review's notes and effort on the row, owed until sent", async () => {
    const entry = await saveOne({ notes: 'legs heavy', rpe: 8 });
    expect(rows.get(entry.id)).toMatchObject({ notes: 'legs heavy', rpe: 8, rpeSent: false });
    expect(await getRecording(entry.id)).toMatchObject({ notes: 'legs heavy', rpe: 8 });
  });

  it('stores no effort when the slider was never moved, and no empty notes', async () => {
    const entry = await saveOne({ notes: '', rpe: undefined });
    expect(rows.get(entry.id)?.rpe).toBeUndefined();
    expect(rows.get(entry.id)?.notes).toBeUndefined();
  });

  vaultIt('stamps the athlete who recorded it', async () => {
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

  vaultIt('respects localOnly status for auto-upload off', async () => {
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

  vaultIt('finds nothing in an empty library', () => {
    expect(holdsRecordingStartingIn(START, START + 3_600_000)).toBe(false);
  });
});

describe('permission-blocked entries', () => {
  it("an upgrade requeues the upgrading athlete's blocked entries and nobody else's", async () => {
    const a = await saveOne();
    const b = await saveOne({ name: 'Second' });
    const theirs = await saveOne({ name: 'Theirs', athleteId: 'i100001' });
    for (const entry of [a, b, theirs]) setUploadStatus(entry.id, 'permissionBlocked');
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
    setUploadStatus(c.id, 'uploaded');
    setUploadStatus(a.id, 'failed');
    expect(await getVisibleUnuploadedCount()).toBe(2);
  });
});

describe('legacy migration', () => {
  it('adopts pending_uploads entries into the library', async () => {
    const legacyPath = '/mock/docs/pending_uploads/123.fit';
    mockFileStore.set(legacyPath, new Uint8Array(makeBuffer()));
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

  vaultIt('is a no-op without a legacy queue', async () => {
    await migrateLegacyUploadQueue();
    expect(await listRecordings()).toHaveLength(0);
  });

  it('does not duplicate entries when run twice', async () => {
    const legacyPath = '/mock/docs/pending_uploads/9.fit';
    mockFileStore.set(legacyPath, new Uint8Array(makeBuffer()));
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
    expect(
      JSON.parse(mockStorage.get('veloq-upload-queue-unadoptable')!).map(
        (e: { id: string }) => e.id
      )
    ).toEqual(['gone']);
  });

  it('archives a queue that does not parse and retires the key', async () => {
    const truncated = '[{"id":"a","filePath":"/mock/docs/pending_up';
    mockStorage.set('veloq-upload-queue', truncated);

    await migrateLegacyUploadQueue();

    expect(mockStorage.has('veloq-upload-queue')).toBe(false);
    expect(mockStorage.get('veloq-upload-queue-unadoptable')).toBe(truncated);
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

/**
 * Scenario: an update moved the app's data container and kept its files, so
 * every absolute path an earlier launch stored names a directory that is gone.
 * Expected behaviour: each file is found again under the live documents
 * directory by its name, and nothing that is still on disk is given up on.
 */
describe('a data container that moved', () => {
  const OLD_DOCS = '/old-container/Documents/';

  it('adopts a queued upload whose stored path names the old container', async () => {
    mockFileStore.set('/mock/docs/pending_uploads/7.fit', 'RklU');
    mockDirStore.add('/mock/docs/pending_uploads/');
    mockStorage.set(
      'veloq-upload-queue',
      JSON.stringify([
        {
          id: '7-x',
          filePath: `${OLD_DOCS}pending_uploads/7.fit`,
          activityType: 'Ride',
          name: 'Seven',
          createdAt: 7,
          retryCount: 0,
        },
      ])
    );

    await migrateLegacyUploadQueue();

    expect(rows.has('7-x')).toBe(true);
    expect(mockFileStore.get('/mock/docs/recordings/7-x.fit')).toBe('RklU');
    expect(mockStorage.has('veloq-upload-queue-unadoptable')).toBe(false);
    expect(mockStorage.has('veloq-upload-queue')).toBe(false);
    expect((await getRecording('7-x'))!.fitPath).toBe('/mock/docs/recordings/7-x.fit');
  });

  it('keeps pending_uploads while it holds the file of an entry settled as missing', async () => {
    const stray = '/mock/docs/pending_uploads/8.fit';
    mockFileStore.set(stray, 'RklU');
    mockDirStore.add('/mock/docs/pending_uploads/');
    mockStorage.set(
      'veloq-upload-queue',
      JSON.stringify([
        {
          id: '8-x',
          filePath: `${OLD_DOCS}pending_uploads/8.fit`,
          activityType: 'Ride',
          name: 'Eight',
          createdAt: 8,
          retryCount: 0,
        },
      ])
    );
    // Both probes during adoption miss the file, as a transient read can.
    const probe = jest.mocked(FileSystem.getInfoAsync);
    const real = probe.getMockImplementation()!;
    let misses = 2;
    probe.mockImplementation(async (path: string) => {
      if (path.endsWith('/8.fit') && misses > 0) {
        misses -= 1;
        return { exists: false, isDirectory: false, uri: path };
      }
      return real(path);
    });

    await migrateLegacyUploadQueue();
    probe.mockImplementation(real);

    expect(mockStorage.has('veloq-upload-queue-unadoptable')).toBe(true);
    expect(mockFileStore.get(stray)).toBe('RklU');
    expect(mockDirStore.has('/mock/docs/pending_uploads/')).toBe(true);
  });

  it('finds the FIT of a saved recording whose stored path names the old container', async () => {
    const entry = await saveOne();
    const name = entry.fitPath.slice(entry.fitPath.lastIndexOf('/') + 1);
    rows.get(entry.id)!.fitPath = `${OLD_DOCS}recordings/${name}`;

    const read = (await getRecording(entry.id))!;

    expect(read.fitPath).toBe(`/mock/docs/recordings/${name}`);
    expect(await recordingFitExists(read)).toBe(true);
  });

  it('stores file names relative to the documents directory and reads them back live', async () => {
    const entry = await saveOne();
    const manual = await saveOne({
      fitBuffer: undefined,
      manualBody: { type: 'Rowing', name: 'Erg' } as never,
    });

    expect(rows.get(entry.id)!.fitPath).toBe(`recordings/${entry.id}.fit`);
    expect(rows.get(manual.id)!.streamsPath).toBe(`recordings/${manual.id}.manual.json`);
    expect(rows.get(manual.id)!.fitPath).toBe('');
    expect(entry.fitPath).toBe(`/mock/docs/recordings/${entry.id}.fit`);
    expect((await getRecording(manual.id))!.streamsPath).toBe(
      `/mock/docs/recordings/${manual.id}.manual.json`
    );
    expect((await getRecording(manual.id))!.fitPath).toBe('');
  });

  it('deletes the files of a row stored under the old container', async () => {
    const entry = await saveOne();
    rows.get(entry.id)!.fitPath = `${OLD_DOCS}recordings/${entry.id}.fit`;

    await deleteRecording(entry.id);

    expect(mockFileStore.has(`/mock/docs/recordings/${entry.id}.fit`)).toBe(false);
  });
});

/**
 * Scenario: a five-hour ride's FIT file is encoded for the upload queue.
 *
 * Expected behaviour: the same bytes come back out, whatever the length, and
 * a chunk boundary is not a place where a byte can go missing.
 */
describe('adoptOwnerlessRecordings', () => {
  const ownerless = (id: string): Row => ({
    id,
    fitPath: `recordings/${id}.fit`,
    kind: 'fit',
    activityType: 'Ride',
    name: `Ride ${id}`,
    startTime: 1_700_000_000_000,
    durationSeconds: 3600,
    distanceMeters: 25_000,
    createdAt: 1_700_000_000_000,
    uploadStatus: 'pending',
    retryCount: 0,
  });
  const seed = (...ids: string[]) => ids.forEach((id) => rows.set(id, ownerless(id)));
  const athletesOf = () => [...rows.values()].map((row) => row.athleteId);

  it("stamps an upgrader's ownerless rides with the library's athlete on the first launch", async () => {
    seed('a', 'b');

    await adoptOwnerlessRecordings(async () => 'iA');

    expect(athletesOf()).toEqual(['iA', 'iA']);
  });

  it('stamps nothing at a later launch, when the library is named for someone else', async () => {
    seed('a');
    await adoptOwnerlessRecordings(async () => 'iA');
    seed('b');

    await adoptOwnerlessRecordings(async () => 'iB');

    expect(rows.get('a')?.athleteId).toBe('iA');
    expect(rows.get('b')?.athleteId).toBeUndefined();
  });

  it('leaves rides unstamped and settles when no athlete is cached', async () => {
    seed('a');

    await adoptOwnerlessRecordings(async () => null);
    await adoptOwnerlessRecordings(async () => 'iB');

    expect(athletesOf()).toEqual([undefined]);
  });

  it('retries on the next launch when the legacy upload queue is left behind', async () => {
    const filePath = '/mock/docs/pending_uploads/q1.fit';
    mockFileStore.set(filePath, 'RklU');
    mockStorage.set(
      'veloq-upload-queue',
      JSON.stringify([
        { id: 'q1', filePath, activityType: 'Ride', name: 'Queued', createdAt: 1, retryCount: 0 },
      ])
    );
    const insert = jest.spyOn(mockEngine, 'addRecording').mockImplementationOnce(() => {
      throw new Error('write failed');
    });

    await adoptOwnerlessRecordings(async () => 'iA');
    expect(mockStorage.has('veloq-upload-queue')).toBe(true);
    insert.mockRestore();

    await adoptOwnerlessRecordings(async () => 'iA');
    expect(athletesOf()).toEqual(['iA']);
    expect(mockStorage.has('veloq-upload-queue')).toBe(false);
  });

  it('neither reads nor removes a retired index key, and still settles', async () => {
    mockStorage.set('veloq-recording-library', JSON.stringify([ownerless('stale')]));

    await adoptOwnerlessRecordings(async () => 'iA');

    expect(rows.size).toBe(0);
    expect(mockStorage.has('veloq-recording-library')).toBe(true);
    expect(mockStorage.has('ownerless_recordings_settled')).toBe(true);
  });

  it('stamps nothing once an account change has settled the adoptions', async () => {
    const {
      settleOwnerlessAdoptions,
    } = require('@/features/recording/lib/storage/recordingBackup');
    seed('a');
    await settleOwnerlessAdoptions();

    await adoptOwnerlessRecordings(async () => 'iA');

    expect(athletesOf()).toEqual([undefined]);
  });
});

describe('reading before the engine opens', () => {
  it('rejects with the engine not-open failure, so a screen names it', async () => {
    mockEngineOpen = false;

    for (const read of [() => listVisibleRecordings(), () => getVisibleRecording('rec-any')]) {
      const failure = await read().then(
        () => undefined,
        (error: unknown) => error
      );
      expect(engineErrorTag(failure)).toBe('NotInitialized');
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
