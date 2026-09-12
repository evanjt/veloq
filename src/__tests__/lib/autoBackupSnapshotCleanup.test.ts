/**
 * Scenario: auto-backup takes a full SQLite snapshot into the cache directory
 * before it uploads. The filename carries a timestamp, so every attempt takes
 * a fresh one and nothing sweeps the directory.
 *
 * Expected behaviour: the snapshot is deleted whichever way the attempt ends,
 * and a backend that needs the network is not asked for one at all while the
 * radio is down, so a backgrounded phone out of signal cannot fill the cache
 * with copies of the database.
 */

import {
  performBackup,
  registerBackend,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';
import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';

const mockSettings = new Map<string, string>();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    startBackup: jest.fn(),
    pollBackup: () => 'complete',
    getBackupMetadata: () => ({ schema_version: '14', activity_count: '1', athlete_id: 'i1' }),
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
}));

const upload = jest.fn(async () => {});

const remoteBackend: BackupBackend = {
  id: 'test-remote',
  name: 'Test Remote',
  isRemote: true,
  isAvailable: async () => true,
  listBackups: async () => [],
  upload: () => upload(),
  download: async () => {},
  delete: async () => {},
};

const localish: BackupBackend = {
  ...remoteBackend,
  id: 'test-localish',
  name: 'Test Localish',
  isRemote: false,
};

registerBackend(remoteBackend);
registerBackend(localish);

const deleteAsync = FileSystem.deleteAsync as jest.MockedFunction<typeof FileSystem.deleteAsync>;
const networkState = Network.getNetworkStateAsync as jest.MockedFunction<
  typeof Network.getNetworkStateAsync
>;

function useBackend(id: string) {
  mockSettings.clear();
  mockSettings.set('__backup_backend', id);
  mockSettings.set('__auto_backup_enabled', '1');
}

beforeEach(() => {
  jest.clearAllMocks();
  networkState.mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  } as never);
  upload.mockImplementation(async () => {});
  useBackend('test-remote');
});

describe('the auto-backup snapshot in the cache directory', () => {
  it('deletes the snapshot when the upload succeeds', async () => {
    await performBackup();

    expect(deleteAsync).toHaveBeenCalledWith(expect.stringContaining('veloq-autobackup-'), {
      idempotent: true,
    });
  });

  it('deletes the snapshot when the upload throws', async () => {
    upload.mockRejectedValueOnce(new Error('upload refused'));

    await expect(performBackup()).rejects.toThrow('upload refused');

    expect(deleteAsync).toHaveBeenCalledWith(expect.stringContaining('veloq-autobackup-'), {
      idempotent: true,
    });
  });

  it('takes no snapshot for a remote backend while the radio is down', async () => {
    networkState.mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);

    await expect(performBackup()).resolves.toBe(false);

    expect(upload).not.toHaveBeenCalled();
    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it('still backs up to a backend that writes locally while the radio is down', async () => {
    useBackend('test-localish');
    networkState.mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);

    await expect(performBackup()).resolves.toBe(true);

    expect(upload).toHaveBeenCalled();
  });

  it('does not skip on a network read that throws, so a backup is never lost to it', async () => {
    networkState.mockRejectedValue(new Error('no permission'));

    await expect(performBackup()).resolves.toBe(true);

    expect(upload).toHaveBeenCalled();
  });
});
