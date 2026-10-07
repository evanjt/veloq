/**
 * Auto-backup writes the native record archive before uploading it. A failed
 * upload must leave that archive available to platform backup, and a remote
 * destination with no radio must still refresh the platform copy.
 */

import { performBackup, type BackupBackend } from '@/features/settings/lib/autobackup';
import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';

const mockSettings = new Map<string, string>();
const mockRunRecordBackup = jest.fn(async (_path: string) => {});

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    engineInstall: () => 1,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    runRecordBackup: (path: string) => mockRunRecordBackup(path),
    getBackupMetadata: () => ({ schema_version: '14', activity_count: '1', athlete_id: 'i1' }),
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
}));

const upload = jest.fn(async (_path: string, _entry: unknown) => {});

const remoteBackend: BackupBackend = {
  id: 'test-remote',
  name: 'Test Remote',
  isRemote: true,
  isAvailable: async () => true,
  listBackups: async () => [],
  upload: (path, entry) => upload(path, entry),
  download: async () => {},
  delete: async () => {},
};

const localish: BackupBackend = {
  ...remoteBackend,
  id: 'test-localish',
  name: 'Test Localish',
  isRemote: false,
};

const mockCarriers: BackupBackend[] = [];
jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  get backupCarriers() {
    return mockCarriers;
  },
}));

const deleteAsync = FileSystem.deleteAsync as jest.MockedFunction<typeof FileSystem.deleteAsync>;
const networkState = Network.getNetworkStateAsync as jest.MockedFunction<
  typeof Network.getNetworkStateAsync
>;

function useBackend(id: string) {
  mockSettings.clear();
  mockCarriers.length = 0;
  mockCarriers.push(id === 'test-localish' ? localish : remoteBackend);
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

describe('the record archive used by auto-backup', () => {
  it('uploads the record archive and refreshes the native backup copy', async () => {
    await performBackup();

    expect(mockRunRecordBackup).toHaveBeenCalledWith('/docs/veloq-decisions.zip');
    expect(upload).toHaveBeenCalledWith('file:///docs/veloq-decisions.zip', expect.anything());
    expect(upload.mock.calls[0][1]).toMatchObject({ sizeBytes: 4096 });
    expect(upload.mock.calls[0][1]).not.toHaveProperty('schemaVersion');
  });
  it('marks the platform archive as this library its own, so it is never offered back', async () => {
    networkState.mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);

    await performBackup();

    expect(mockSettings.get('__platform_record_answered')).toBe('1');
  });

  it('keeps the native archive when the upload succeeds', async () => {
    await performBackup();

    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it('keeps the native archive when the upload throws', async () => {
    upload.mockRejectedValueOnce(new Error('upload refused'));

    await expect(performBackup()).resolves.toMatchObject({
      wroteZip: true,
      carriers: { 'test-remote': { status: 'failed', kind: 'unknown' } },
    });

    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it('refreshes the platform archive while skipping remote upload without a radio', async () => {
    networkState.mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);

    await expect(performBackup()).resolves.toMatchObject({
      wroteZip: true,
      carriers: { 'test-remote': { status: 'skipped', reason: 'no-radio' } },
    });

    expect(upload).not.toHaveBeenCalled();
    expect(mockRunRecordBackup).toHaveBeenCalledWith('/docs/veloq-decisions.zip');
    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it('still backs up to a backend that writes locally while the radio is down', async () => {
    useBackend('test-localish');
    networkState.mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);

    await expect(performBackup()).resolves.toMatchObject({ wroteZip: true });

    expect(upload).toHaveBeenCalled();
  });

  it('does not skip on a network read that throws, so a backup is never lost to it', async () => {
    networkState.mockRejectedValue(new Error('no permission'));

    await expect(performBackup()).resolves.toMatchObject({ wroteZip: true });

    expect(upload).toHaveBeenCalled();
  });
});
