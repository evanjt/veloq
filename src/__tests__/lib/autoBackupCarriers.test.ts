/**
 * Scenario: the athlete has more than one carrier set up.
 * Expected behaviour: one run writes the zip once and hands it to every
 * available carrier, each on its own, and reports what each one did.
 */

import {
  performBackup,
  getLastBackupFailure,
  getBackupFailures,
  cleanUpRetiredBackupSettings,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';
import { BackupTransferError } from '@/features/settings/lib/autobackup/backends/errors';
import * as FileSystem from 'expo-file-system/legacy';

const mockSettings = new Map<string, string>();
const mockRunRecordBackup = jest.fn(async (_path: string) => {});
const mockCarriers: BackupBackend[] = [];

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    deleteSetting: (key: string) => mockSettings.delete(key),
    engineInstall: () => 1,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    runRecordBackup: (path: string) => mockRunRecordBackup(path),
  }),
}));

jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  get backupCarriers() {
    return mockCarriers;
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: jest
    .fn()
    .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
}));

function carrier(id: string, upload: BackupBackend['upload'], available = true): BackupBackend {
  return {
    id,
    name: id,
    isRemote: false,
    isAvailable: async () => available,
    listBackups: async () => [],
    upload,
    download: async () => {},
    delete: async () => {},
  };
}

const webdavUpload = jest.fn(async (_path: string, _entry: unknown) => {});
const folderUpload = jest.fn(async (_path: string, _entry: unknown) => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.clear();
  mockSettings.set('__auto_backup_enabled', '1');
  webdavUpload.mockImplementation(async () => {});
  folderUpload.mockImplementation(async () => {});
  mockCarriers.length = 0;
  mockCarriers.push(carrier('webdav', webdavUpload), carrier('folder', folderUpload));
});

describe('automatic backup carriers', () => {
  it('uploads the same zip to every available carrier', async () => {
    const result = await performBackup();

    expect(webdavUpload.mock.calls[0][0]).toBe('file:///docs/veloq-decisions.zip');
    expect(folderUpload.mock.calls[0][0]).toBe('file:///docs/veloq-decisions.zip');
    expect(result).toEqual({
      wroteZip: true,
      carriers: { webdav: { status: 'written' }, folder: { status: 'written' } },
    });
    expect(mockSettings.get('__last_auto_backup')).toBeDefined();
  });

  it('keeps writing to the other carrier when one is rejected permanently', async () => {
    webdavUpload.mockRejectedValue(new BackupTransferError('upload', 'auth', 'rejected', 401));

    const result = await performBackup();

    expect(folderUpload).toHaveBeenCalledTimes(1);
    expect(result.carriers.folder).toEqual({ status: 'written' });
    expect(result.carriers.webdav).toEqual({ status: 'failed', kind: 'auth' });
    expect(Object.keys(getBackupFailures())).toEqual(['webdav']);
    expect(getLastBackupFailure()).toMatchObject({ kind: 'auth', status: 401 });
  });

  it('clears a carrier failure once that carrier writes again', async () => {
    webdavUpload.mockRejectedValueOnce(new BackupTransferError('upload', 'auth', 'rejected', 401));
    await performBackup(true);
    await performBackup(true);

    expect(getBackupFailures()).toEqual({});
  });

  it('skips a carrier that is not set up and reports it', async () => {
    mockCarriers[1] = carrier('folder', folderUpload, false);

    const result = await performBackup();

    expect(folderUpload).not.toHaveBeenCalled();
    expect(result.carriers.folder).toEqual({ status: 'skipped', reason: 'unavailable' });
    expect(result.carriers.webdav).toEqual({ status: 'written' });
  });

  it('writes nothing while the switch is off, and a forced run writes the zip and uploads', async () => {
    mockSettings.set('__auto_backup_enabled', '0');

    expect(await performBackup()).toEqual({ wroteZip: false, carriers: {} });
    expect(mockRunRecordBackup).not.toHaveBeenCalled();
    expect(webdavUpload).not.toHaveBeenCalled();
    expect(folderUpload).not.toHaveBeenCalled();

    const forced = await performBackup(true);
    expect(mockRunRecordBackup).toHaveBeenCalledTimes(1);
    expect(forced.wroteZip).toBe(true);
    expect(webdavUpload).toHaveBeenCalledTimes(1);
    expect(folderUpload).toHaveBeenCalledTimes(1);
  });

  it('never writes under the old backups directory, whatever the retired setting says', async () => {
    mockSettings.set('__backup_backend', 'local');
    mockCarriers.length = 0;

    await performBackup();

    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(FileSystem.makeDirectoryAsync).not.toHaveBeenCalled();
  });

  it('retires the carrier choice at launch and keeps the switch', () => {
    mockSettings.set('__backup_backend', 'webdav');

    cleanUpRetiredBackupSettings();

    expect(mockSettings.has('__backup_backend')).toBe(false);
    expect(mockSettings.get('__auto_backup_enabled')).toBe('1');
  });
});
