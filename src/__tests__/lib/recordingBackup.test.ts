/**
 * Tests for crash-recovery backup storage.
 *
 * Covers: buildRecordingBackup (state snapshot → backup, ongoing-pause fold,
 * non-restorable states), save/load round-trip, and schema validation
 * (version, status, stopTime).
 */

import {
  buildRecordingBackup,
  saveRecordingBackup,
  loadRecordingBackup,
  clearRecordingBackup,
  adoptOwnerlessRecordingBackup,
  settleOwnerlessAdoptions,
} from '@/features/recording/lib/storage/recordingBackup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { RecordingStreams } from '@/features/recording/types';
import { useAuthStore } from '@/shared/app/AuthStore';
import * as replaceFileModule from '@/shared/native/replaceFile';

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
  ...jest.requireActual('expo-file-system/legacy'),
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
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!mockFileStore.has(from)) throw new Error('ENOENT');
    mockFileStore.set(to, mockFileStore.get(from)!);
    mockFileStore.delete(from);
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockFileStore.delete(path);
  }),
}));

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

beforeEach(async () => {
  mockFileStore.clear();
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  useAuthStore.setState({ athleteId: null });
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
  it('does not discard a newer backup through an older alert', async () => {
    const earlier = { ...buildRecordingBackup(makeState())!, athleteId: 'i1' };
    const later = {
      ...buildRecordingBackup(makeState({ startTime: 2_000_000 }))!,
      athleteId: 'i1',
    };
    useAuthStore.setState({ athleteId: 'i1' });
    await saveRecordingBackup(earlier);
    await saveRecordingBackup(later);
    await clearRecordingBackup('i1', earlier);
    expect((await loadRecordingBackup())?.startTime).toBe(later.startTime);
  });
  it('keeps a stopped ride for its athlete when another athlete writes a backup', async () => {
    const first = { ...buildRecordingBackup(makeState({ status: 'stopped' }))!, athleteId: 'i1' };
    const second = { ...buildRecordingBackup(makeState())!, athleteId: 'i2' };
    await saveRecordingBackup(first);
    await saveRecordingBackup(second);

    useAuthStore.setState({ athleteId: 'i1' });
    expect((await loadRecordingBackup())?.status).toBe('stopped');
    useAuthStore.setState({ athleteId: 'i2' });
    expect((await loadRecordingBackup())?.status).toBe('recording');
  });
  it('round-trips a v2 backup', async () => {
    const backup = buildRecordingBackup(makeState())!;
    await saveRecordingBackup(backup);
    expect(mockFileStore.has(BACKUP_PATH)).toBe(true);

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
    expect(mockFileStore.has(BACKUP_PATH)).toBe(false);
  });
});

describe('savedAt stamping', () => {
  // Restore credits the savedAt→now gap as paused time, so savedAt has to be
  // the moment of the snapshot rather than the moment recording started.
  it('stamps the snapshot with the current clock, not the start time', () => {
    const now = 1_500_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const backup = buildRecordingBackup(makeState({ startTime: 1_000_000 }))!;
    expect(backup.savedAt).toBe(now);
  });
});

it('round-trips missing altitude separately from real zero', async () => {
  const streams = makeStreams();
  streams.altitude = [NaN, 0, NaN, 2, NaN];
  const backup = buildRecordingBackup(makeState({ streams }))!;
  await saveRecordingBackup(backup);
  const restored = await loadRecordingBackup();
  expect(restored?.streams.altitude).toEqual(streams.altitude);
});

it.each([
  ['absent', undefined],
  ['not an array', 'truncated'],
])('restores a backup whose altitude is %s as missing samples', async (_label, altitude) => {
  const backup = buildRecordingBackup(makeState())!;
  await saveRecordingBackup(backup);
  const stored = JSON.parse(mockFileStore.get(BACKUP_PATH)!);
  stored.streams.altitude = altitude;
  mockFileStore.set(BACKUP_PATH, JSON.stringify(stored));
  const restored = await loadRecordingBackup();
  expect(restored?.streams.latlng).toEqual(backup.streams.latlng);
  expect(restored?.streams.altitude).toEqual([NaN, NaN, NaN]);
});

describe('an ownerless backup from a build before the athlete stamp', () => {
  const ATHLETE_PATH = '/mock/docs/recording_backup_i1.json';

  function writeOwnerless(overrides: Record<string, unknown> = {}) {
    const backup = buildRecordingBackup(makeState({ status: 'stopped', stopTime: 1_900_000 }))!;
    mockFileStore.set(BACKUP_PATH, JSON.stringify({ ...backup, version: 2, ...overrides }));
    return backup;
  }

  it('goes to the athlete whose library it was written beside, and to nobody else', async () => {
    const backup = writeOwnerless();
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    useAuthStore.setState({ athleteId: 'i1' });
    const loaded = await loadRecordingBackup();
    expect(loaded?.athleteId).toBe('i1');
    expect(loaded?.startTime).toBe(backup.startTime);
    expect(loaded?.streams.latlng).toEqual(backup.streams.latlng);
    expect(mockFileStore.has(BACKUP_PATH)).toBe(false);

    useAuthStore.setState({ athleteId: 'i2' });
    expect(await loadRecordingBackup()).toBeNull();
  });

  it('stays on disk untouched and offered to nobody when no library is named', async () => {
    writeOwnerless();
    const before = mockFileStore.get(BACKUP_PATH);
    await adoptOwnerlessRecordingBackup(async () => null);

    expect(mockFileStore.get(BACKUP_PATH)).toBe(before);
    expect(mockFileStore.has(ATHLETE_PATH)).toBe(false);
    useAuthStore.setState({ athleteId: 'i1' });
    expect(await loadRecordingBackup()).toBeNull();
  });

  it('runs once, so a library named later is never handed a ride it did not record', async () => {
    writeOwnerless();
    await adoptOwnerlessRecordingBackup(async () => null);
    await adoptOwnerlessRecordingBackup(async () => 'i2');

    expect(mockFileStore.has(BACKUP_PATH)).toBe(true);
    expect(mockFileStore.has('/mock/docs/recording_backup_i2.json')).toBe(false);
  });

  it("never overwrites the athlete's own newer backup", async () => {
    writeOwnerless();
    const newer = {
      ...buildRecordingBackup(makeState({ startTime: 3_000_000 }))!,
      athleteId: 'i1',
    };
    await saveRecordingBackup(newer);
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    useAuthStore.setState({ athleteId: 'i1' });
    expect((await loadRecordingBackup())?.startTime).toBe(3_000_000);
    expect(mockFileStore.has(BACKUP_PATH)).toBe(true);
  });

  it('keeps the old file when the copy cannot be written', async () => {
    writeOwnerless();
    const FileSystem = require('expo-file-system/legacy');
    jest.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async () => {
      throw new Error('ENOSPC');
    });
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    expect(mockFileStore.has(BACKUP_PATH)).toBe(true);
    expect(mockFileStore.has(ATHLETE_PATH)).toBe(false);
  });

  it('offers the ride to the athlete it was recorded for once a failed copy can be written again', async () => {
    const backup = writeOwnerless();
    jest.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async () => {
      throw new Error('ENOSPC');
    });
    await adoptOwnerlessRecordingBackup(async () => 'i1');
    expect(mockFileStore.has(BACKUP_PATH)).toBe(true);

    await adoptOwnerlessRecordingBackup(async () => 'i1');

    expect(mockFileStore.has(BACKUP_PATH)).toBe(false);
    useAuthStore.setState({ athleteId: 'i1' });
    expect((await loadRecordingBackup())?.startTime).toBe(backup.startTime);
    useAuthStore.setState({ athleteId: 'i2' });
    expect(await loadRecordingBackup()).toBeNull();
  });

  it('offers the ride to its athlete after a copy cut short, and never to another', async () => {
    const backup = writeOwnerless();
    jest.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async (target, data) => {
      mockFileStore.set(target, data.slice(0, 40));
      throw new Error('ENOSPC');
    });
    await adoptOwnerlessRecordingBackup(async () => 'i1');
    await adoptOwnerlessRecordingBackup(async () => 'i2');
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    useAuthStore.setState({ athleteId: 'i1' });
    expect((await loadRecordingBackup())?.startTime).toBe(backup.startTime);
    useAuthStore.setState({ athleteId: 'i2' });
    expect(await loadRecordingBackup()).toBeNull();
    expect(mockFileStore.has(BACKUP_PATH)).toBe(false);
  });

  it('replaces an unreadable file at the athlete path with the copy', async () => {
    const backup = writeOwnerless();
    mockFileStore.set(ATHLETE_PATH, '{"athleteId":"i1","startT');
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    useAuthStore.setState({ athleteId: 'i1' });
    expect((await loadRecordingBackup())?.startTime).toBe(backup.startTime);
    expect(mockFileStore.has(BACKUP_PATH)).toBe(false);
  });

  it('keeps the old file and does not settle when the copy reads back wrong', async () => {
    writeOwnerless();
    const read = jest.mocked(FileSystem.readAsStringAsync).getMockImplementation()!;
    jest.mocked(FileSystem.readAsStringAsync).mockImplementation(async (path: string) => {
      const text = await read(path);
      return path === ATHLETE_PATH ? text.slice(0, 40) : text;
    });
    try {
      await adoptOwnerlessRecordingBackup(async () => 'i1');
    } finally {
      jest.mocked(FileSystem.readAsStringAsync).mockImplementation(read);
    }

    expect(mockFileStore.has(BACKUP_PATH)).toBe(true);
    expect(await AsyncStorage.getItem('ownerless_recording_backup_settled')).toBeNull();
  });

  it('retries for the athlete the failed copy was for, not the library named at the retry', async () => {
    writeOwnerless();
    jest.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async () => {
      throw new Error('ENOSPC');
    });
    await adoptOwnerlessRecordingBackup(async () => 'i1');
    await adoptOwnerlessRecordingBackup(async () => 'i2');

    expect(mockFileStore.has(ATHLETE_PATH)).toBe(true);
    expect(mockFileStore.has('/mock/docs/recording_backup_i2.json')).toBe(false);
  });

  it('does not retry once the adoptions are settled for an account change', async () => {
    writeOwnerless();
    jest.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async () => {
      throw new Error('ENOSPC');
    });
    await adoptOwnerlessRecordingBackup(async () => 'i1');
    await settleOwnerlessAdoptions();
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    expect(mockFileStore.has(BACKUP_PATH)).toBe(true);
    expect(mockFileStore.has(ATHLETE_PATH)).toBe(false);
  });

  it('retries when the library lookup fails, then offers the ride', async () => {
    const backup = writeOwnerless();
    await adoptOwnerlessRecordingBackup(async () => {
      throw new Error('database busy');
    });
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    useAuthStore.setState({ athleteId: 'i1' });
    expect((await loadRecordingBackup())?.startTime).toBe(backup.startTime);
    expect(mockFileStore.has(BACKUP_PATH)).toBe(false);
  });

  it('retries when the old file cannot be read, then offers the ride', async () => {
    const backup = writeOwnerless();
    jest.mocked(FileSystem.readAsStringAsync).mockImplementationOnce(async () => {
      throw new Error('EIO');
    });
    await adoptOwnerlessRecordingBackup(async () => 'i1');
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    useAuthStore.setState({ athleteId: 'i1' });
    expect((await loadRecordingBackup())?.startTime).toBe(backup.startTime);
  });

  it('finishes a move a kill interrupted between the copy and the delete', async () => {
    const backup = writeOwnerless();
    mockFileStore.set(ATHLETE_PATH, JSON.stringify({ ...backup, athleteId: 'i1', version: 2 }));
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    expect(mockFileStore.has(BACKUP_PATH)).toBe(false);
    useAuthStore.setState({ athleteId: 'i1' });
    expect((await loadRecordingBackup())?.startTime).toBe(backup.startTime);
  });

  it('asks nothing of the library at a launch with no ownerless file', async () => {
    const libraryAthlete = jest.fn(async () => 'i1');
    await adoptOwnerlessRecordingBackup(libraryAthlete);
    writeOwnerless();
    await adoptOwnerlessRecordingBackup(libraryAthlete);

    expect(libraryAthlete).not.toHaveBeenCalled();
  });

  it('leaves a file it cannot read where it is', async () => {
    mockFileStore.set(BACKUP_PATH, '{not json');
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    expect(mockFileStore.get(BACKUP_PATH)).toBe('{not json');
    expect(mockFileStore.has(ATHLETE_PATH)).toBe(false);
  });

  it('is not handed to an athlete a library is named for after the adoption was settled', async () => {
    writeOwnerless();
    const before = mockFileStore.get(BACKUP_PATH);
    await settleOwnerlessAdoptions();
    await adoptOwnerlessRecordingBackup(async () => 'i2');

    expect(mockFileStore.get(BACKUP_PATH)).toBe(before);
    expect(mockFileStore.has('/mock/docs/recording_backup_i2.json')).toBe(false);
    useAuthStore.setState({ athleteId: 'i2' });
    expect(await loadRecordingBackup()).toBeNull();
  });

  describe('when a settlement marker cannot be written', () => {
    const markers = ['ownerless_recording_backup_settled', 'ownerless_recordings_settled'];
    let written: string[];
    const setItem = AsyncStorage.setItem as jest.Mock;
    const original = setItem.getMockImplementation();

    function failWriteOf(failing: string) {
      written = [];
      setItem.mockImplementation(async (key: string) => {
        if (key === failing) throw new Error('disk full');
        written.push(key);
      });
    }

    afterEach(() => setItem.mockImplementation(original));

    it.each(markers)('rejects on %s, so no identity change follows', async (failing) => {
      failWriteOf(failing);

      await expect(settleOwnerlessAdoptions()).rejects.toThrow('disk full');
    });

    it.each(markers)('still writes the other marker when %s fails', async (failing) => {
      failWriteOf(failing);

      await expect(settleOwnerlessAdoptions()).rejects.toThrow();

      expect(written).toEqual(markers.filter((key) => key !== failing));
    });
  });

  it('settles with no ownerless file on disk, so a later one is not adopted either', async () => {
    await settleOwnerlessAdoptions();
    writeOwnerless();
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    expect(mockFileStore.has(BACKUP_PATH)).toBe(true);
    expect(mockFileStore.has(ATHLETE_PATH)).toBe(false);
  });

  it('still adopts for the athlete whose library it was when nothing settled it first', async () => {
    writeOwnerless();
    await adoptOwnerlessRecordingBackup(async () => 'i1');

    expect(mockFileStore.has(ATHLETE_PATH)).toBe(true);
    expect(mockFileStore.has(BACKUP_PATH)).toBe(false);
  });
});

describe.each([null, 'rider/one'])('atomic backup for %s', (athleteId) => {
  const path = athleteId
    ? `/mock/docs/recording_backup_${encodeURIComponent(athleteId)}.json`
    : BACKUP_PATH;
  const tempPath = `${path}.tmp`;

  beforeEach(() => {
    useAuthStore.setState({ athleteId });
  });

  function snapshot(startTime = 1_000_000) {
    return buildRecordingBackup(makeState({ athleteId, startTime }))!;
  }

  it('writes a complete sibling before replacing the previous snapshot', async () => {
    const earlier = snapshot();
    const later = snapshot(2_000_000);
    await saveRecordingBackup(earlier);
    jest.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async (target, data) => {
      expect(target).toBe(tempPath);
      expect(JSON.parse(mockFileStore.get(path)!)).toMatchObject(earlier);
      mockFileStore.set(target, data);
    });

    expect(await saveRecordingBackup(later)).toBe(true);
    expect(FileSystem.moveAsync).toHaveBeenLastCalledWith({ from: tempPath, to: path });
    expect(await loadRecordingBackup()).toMatchObject(later);
    expect(mockFileStore.has(tempPath)).toBe(false);
  });

  it('keeps the previous ride readable after a partial write fails and can save again', async () => {
    const earlier = snapshot();
    const later = snapshot(2_000_000);
    await saveRecordingBackup(earlier);
    jest.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async (target, data) => {
      mockFileStore.set(target, data.slice(0, 20));
      throw new Error('ENOSPC');
    });

    expect(await saveRecordingBackup(later)).toBe(false);
    expect(await loadRecordingBackup()).toMatchObject(earlier);
    expect(mockFileStore.has(tempPath)).toBe(false);
    expect(await saveRecordingBackup(later)).toBe(true);
    expect(await loadRecordingBackup()).toMatchObject(later);
  });

  it('replaces the snapshot through the atomic replace primitive', async () => {
    const replace = jest.spyOn(replaceFileModule, 'replaceFile');
    expect(await saveRecordingBackup(snapshot())).toBe(true);
    expect(replace).toHaveBeenLastCalledWith(tempPath, path);
    replace.mockRestore();
  });

  it('keeps the previous snapshot when the rename fails', async () => {
    const earlier = snapshot();
    await saveRecordingBackup(earlier);
    jest.mocked(FileSystem.moveAsync).mockRejectedValueOnce(new Error('EIO'));

    expect(await saveRecordingBackup(snapshot(2_000_000))).toBe(false);
    expect(await loadRecordingBackup()).toMatchObject(earlier);
    expect(mockFileStore.has(tempPath)).toBe(false);
  });

  it('serializes a load between saves without deleting an in-flight temporary file', async () => {
    let finishWrite!: () => void;
    const writing = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    jest.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async (target, data) => {
      mockFileStore.set(target, data.slice(0, 20));
      signalStarted();
      await writing;
      mockFileStore.set(target, data);
    });
    const earlier = snapshot();
    const firstSave = saveRecordingBackup(earlier);
    await started;
    const load = loadRecordingBackup();
    const later = snapshot(2_000_000);
    const secondSave = saveRecordingBackup(later);
    finishWrite();

    expect(await firstSave).toBe(true);
    expect(await load).toMatchObject(earlier);
    expect(await secondSave).toBe(true);
    expect(await loadRecordingBackup()).toMatchObject(later);
  });

  it.each([false, true])(
    'discards a stale temporary file with committed backup %s',
    async (committed) => {
      const earlier = snapshot();
      if (committed) await saveRecordingBackup(earlier);
      mockFileStore.set(tempPath, JSON.stringify({ ...snapshot(2_000_000), version: 2 }));

      const loaded = await loadRecordingBackup();
      if (committed) expect(loaded).toMatchObject(earlier);
      else expect(loaded).toBeNull();
      expect(mockFileStore.has(tempPath)).toBe(false);
    }
  );

  it.each([false, true])('clears temporary files with committed backup %s', async (committed) => {
    if (committed) await saveRecordingBackup(snapshot());
    mockFileStore.set(tempPath, '{partial');

    await clearRecordingBackup();
    await clearRecordingBackup();
    expect(mockFileStore.has(path)).toBe(false);
    expect(mockFileStore.has(tempPath)).toBe(false);
  });
});
