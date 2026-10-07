import {
  performBackup,
  getLastBackupTimestamp,
  getLastBackupFailure,
  isPlatformRecordAnswered,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';
import { inBackupSlot } from '@/features/settings/lib/backupSlot';
import { transferFailure } from '@/features/settings/lib/autobackup/backends/errors';

const mockSettings = new Map<string, string>();
const mockFiles = new Map<string, string>();
let mockInstall = 1;
const mockRunRecordBackup = jest.fn(async () => {});
const mockCarriers: BackupBackend[] = [];

jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  get backupCarriers() {
    return mockCarriers;
  },
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    engineInstall: () => mockInstall,
    runRecordBackup: () => mockRunRecordBackup(),
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 4096 })),
  readDirectoryAsync: jest.fn(async () => []),
  writeAsStringAsync: jest.fn(async (path: string, value: string) => {
    mockFiles.set(path, value);
  }),
  copyAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async (path: string) => {
    for (const file of mockFiles.keys()) {
      if (file === path || file.startsWith(path.endsWith('/') ? path : `${path}/`))
        mockFiles.delete(file);
    }
  }),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const upload = jest.fn(async () => {});
const remove = jest.fn(async () => {});
const listBackups = jest.fn(async () => []);
const backend: BackupBackend = {
  id: 'held-remote',
  name: 'Held remote',
  isRemote: true,
  isAvailable: async () => true,
  listBackups,
  upload,
  download: async () => {},
  delete: remove,
};

function wipe() {
  mockInstall += 1;
  mockSettings.clear();
  mockFiles.clear();
}

function expectNoSettings() {
  expect(getLastBackupTimestamp()).toBeNull();
  expect(getLastBackupFailure()).toBeNull();
  expect(isPlatformRecordAnswered()).toBe(false);
  expect([...mockSettings.keys()]).toEqual([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.clear();
  mockFiles.clear();
  mockInstall = 1;
  mockRunRecordBackup.mockImplementation(async () => {});
  upload.mockImplementation(async () => {});
  mockCarriers.length = 0;
  mockCarriers.push(backend);
  mockSettings.set('__auto_backup_enabled', '1');
});

const NOTHING = { wroteZip: false, carriers: {} };

it.each([false, true])(
  'drops settings and keeps remote data when an upload crosses a wipe (failure: %s)',
  async (fails) => {
    const started = deferred();
    const held = deferred();
    upload.mockImplementation(async () => {
      started.resolve();
      await held.promise;
    });
    const backup = performBackup(true);
    await started.promise;
    wipe();
    if (fails) held.reject(transferFailure('Upload backup', 401));
    else held.resolve();

    await expect(backup).resolves.toEqual(NOTHING);
    expectNoSettings();
    expect(remove).not.toHaveBeenCalled();
  }
);

it.each([false, true])(
  'writes nothing when an archive finishes after the wipe (rejected: %s)',
  async (rejects) => {
    const started = deferred();
    const held = deferred();
    mockRunRecordBackup.mockImplementation(async () => {
      started.resolve();
      await held.promise;
    });
    const backup = performBackup(true);
    await started.promise;
    wipe();
    if (rejects) held.reject(new Error('The library changed while the backup was written'));
    else held.resolve();

    await expect(backup).resolves.toEqual(NOTHING);
    expectNoSettings();
    expect(upload).not.toHaveBeenCalled();
  }
);

it('does not upload after the library changes during the availability check', async () => {
  mockCarriers[0] = {
    ...backend,
    isAvailable: async () => {
      wipe();
      return true;
    },
  };
  await expect(performBackup(true)).resolves.toEqual(NOTHING);
  expectNoSettings();
  expect(upload).not.toHaveBeenCalled();
});

it('can back up the next library after dropping an old upload', async () => {
  upload.mockImplementationOnce(async () => {
    wipe();
  });
  await expect(performBackup(true)).resolves.toEqual(NOTHING);
  expectNoSettings();
  mockSettings.set('__auto_backup_enabled', '1');
  await expect(performBackup(true)).resolves.toMatchObject({ wroteZip: true });
  expect(getLastBackupTimestamp()).not.toBeNull();
  expect(isPlatformRecordAnswered()).toBe(true);
  expect(mockRunRecordBackup).toHaveBeenCalledTimes(2);
});

it('tries no further carrier once the library has changed under an earlier one', async () => {
  const second = jest.fn(async () => {});
  mockCarriers.push({ ...backend, id: 'second', upload: second });
  upload.mockImplementationOnce(async () => {
    wipe();
  });
  await expect(performBackup(true)).resolves.toEqual(NOTHING);
  expect(second).not.toHaveBeenCalled();
  expectNoSettings();
});

it('does not start a queued archive after its library is wiped', async () => {
  const started = deferred();
  const held = deferred();
  const first = inBackupSlot(async () => {
    started.resolve();
    await held.promise;
  });
  await started.promise;
  const backup = performBackup(true);
  wipe();
  held.resolve();
  await first;
  await expect(backup).resolves.toEqual(NOTHING);
  expect(mockRunRecordBackup).not.toHaveBeenCalled();
  expectNoSettings();
});
