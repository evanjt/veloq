/** A slow Rust copy must finish before its caller uses the resulting file. */

import { writeClearSnapshot } from '@/features/settings/lib/clearSnapshot';
import { performBackup, type BackupBackend } from '@/features/settings/lib/autobackup';

const writeSnapshot = jest.fn((_destPath: string) => Promise.resolve());
const runRecordArchive = jest.fn((_destPath: string) => Promise.resolve());
const mockSettings = new Map<string, string>();

// No backupDatabase: a call site still using the synchronous copy throws here.
const mockEngine = {
  writeClearSnapshot: writeSnapshot,
  runRecordBackup: (_path: string) => runRecordArchive(_path),
  getSetting: (key: string) => mockSettings.get(key),
  engineInstall: () => 1,
  setSetting: (key: string, value: string) => mockSettings.set(key, value),
  destroyEngine: jest.fn(),
  getActivityCount: () => 408,
  notifyAll: jest.fn(),
};

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => ({}),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/shared/query/QueryProvider', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => ({ athleteId: 'i1' }) },
}));

/** A copy that lands after the caller has had a chance to do something else. */
function landsOnALaterTick(): void {
  writeSnapshot.mockImplementation(() => new Promise<void>((resolve) => setImmediate(resolve)));
}

const upload = jest.fn();
const uploadBackend: BackupBackend = {
  id: 'test-remote',
  name: 'Test Remote',
  isRemote: false,
  isAvailable: async () => true,
  listBackups: async () => [],
  upload: (localPath, metadata) => upload(localPath, metadata),
  download: async () => {},
  delete: async () => {},
};
const mockCarriers: BackupBackend[] = [uploadBackend];
jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  get backupCarriers() {
    return mockCarriers;
  },
}));

beforeEach(() => {
  writeSnapshot.mockReset();
  writeSnapshot.mockResolvedValue(undefined);
  runRecordArchive.mockReset();
  runRecordArchive.mockResolvedValue(undefined);
  upload.mockReset();
  mockSettings.clear();
});

describe('writeClearSnapshot', () => {
  it('carries the engine failure through, message intact', async () => {
    writeSnapshot.mockRejectedValue(new Error('Backup thread died without a result'));

    await expect(writeClearSnapshot(mockEngine, '/cache/out.veloqdb')).rejects.toThrow(
      /died without a result/
    );
  });

  it('leaves the JS thread free while the copy runs', async () => {
    landsOnALaterTick();
    let ranWhileCopying = false;

    const pending = writeClearSnapshot(mockEngine, '/cache/out.veloqdb');
    ranWhileCopying = true;

    await expect(pending).resolves.toBeUndefined();
    expect(ranWhileCopying).toBe(true);
  });
});

describe('performBackup', () => {
  it('uploads only after the copy has finished', async () => {
    let copied = false;
    runRecordArchive.mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          setImmediate(() => {
            copied = true;
            resolve();
          })
        )
    );
    let copiedWhenUploaded = false;
    upload.mockImplementation(() => {
      copiedWhenUploaded = copied;
      return Promise.resolve();
    });

    await expect(performBackup(true)).resolves.toMatchObject({ wroteZip: true });

    expect(runRecordArchive).toHaveBeenCalledTimes(1);
    expect(copiedWhenUploaded).toBe(true);
  });
});
