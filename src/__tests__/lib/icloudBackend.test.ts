/**
 * Scenario: the iCloud backend moves a database snapshot in and out of the
 * user's iCloud Drive.
 * Expected behaviour: bytes move natively at Documents scope, a listed file is
 * synced before it is read, and a write that does not land is a failed backup.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { icloudBackend } from '@/features/settings/lib/autobackup/backends/icloudBackend';
import { isBackupTransferError } from '@/features/settings/lib/autobackup/backends/errors';
import type { BackupEntry } from '@/features/settings/lib/autobackup/backends/types';

const mockCloudStorage = {
  setProviderOptions: jest.fn(),
  isCloudAvailable: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  triggerSync: jest.fn(),
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  unlink: jest.fn(),
};

jest.mock('react-native-cloud-storage', () => ({
  CloudStorage: mockCloudStorage,
  CloudStorageScope: { Documents: 'documents', AppData: 'app_data' },
}));

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  __esModule: true,
  default: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
}));

jest.mock('expo-file-system/legacy', () => ({
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

const METADATA: Omit<BackupEntry, 'id'> = {
  timestamp: '2026-08-05T10:00:00.000Z',
  sizeBytes: 4096,
  appVersion: '0.4.0',
  schemaVersion: 14,
  activityCount: 312,
  athleteId: 'i12345',
};

const FILENAME = 'veloq-2026-08-05T10-00-00-000Z.veloqdb';

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  // setProviderOptions is deliberately left alone: it runs once per module
  // lifetime, so clearing it would make the assertion order dependent
  for (const [name, fn] of Object.entries(mockCloudStorage)) {
    if (name !== 'setProviderOptions') fn.mockReset();
  }
  (FileSystem.deleteAsync as jest.Mock).mockClear();
  mockCloudStorage.isCloudAvailable.mockResolvedValue(true);
  mockCloudStorage.exists.mockResolvedValue(true);
  mockCloudStorage.triggerSync.mockResolvedValue(undefined);
});

describe('icloudBackend.isAvailable', () => {
  it('reports unavailable when iCloud Drive is off', async () => {
    mockCloudStorage.isCloudAvailable.mockResolvedValue(false);

    await expect(icloudBackend.isAvailable()).resolves.toBe(false);
  });

  it('reports unavailable rather than throwing when the native call fails', async () => {
    mockCloudStorage.isCloudAvailable.mockRejectedValue(new Error('no container'));

    await expect(icloudBackend.isAvailable()).resolves.toBe(false);
  });

  it('pins the provider to the Documents scope', async () => {
    await icloudBackend.isAvailable();

    expect(mockCloudStorage.setProviderOptions).toHaveBeenCalledWith({ scope: 'documents' });
  });
});

describe('icloudBackend.listBackups', () => {
  it('syncs each sidecar before reading it and skips a corrupt one', async () => {
    mockCloudStorage.readdir.mockResolvedValue([
      `${FILENAME}`,
      'veloq-broken.veloqdb.meta.json',
      'veloq-good.veloqdb.meta.json',
    ]);
    mockCloudStorage.readFile.mockImplementation(async (path: string) =>
      path.includes('broken')
        ? 'not json at all'
        : JSON.stringify({ ...METADATA, id: 'veloq-good.veloqdb' })
    );

    const entries = await icloudBackend.listBackups();

    expect(entries.map((e) => e.id)).toEqual(['veloq-good.veloqdb']);
    expect(mockCloudStorage.triggerSync).toHaveBeenCalledWith(
      '/Veloq/veloq-good.veloqdb.meta.json'
    );
  });

  it('returns an empty list when the directory has never been created', async () => {
    mockCloudStorage.exists.mockResolvedValue(false);

    await expect(icloudBackend.listBackups()).resolves.toEqual([]);
    expect(mockCloudStorage.readdir).not.toHaveBeenCalled();
  });

  it('reports an authentication failure instead of an empty list', async () => {
    mockCloudStorage.readdir.mockRejectedValue(codedError('ERR_AUTHENTICATION_FAILED'));

    const error = await icloudBackend.listBackups().catch((e) => e);

    expect(isBackupTransferError(error)).toBe(true);
    expect(error.kind).toBe('auth');
    expect(error.permanent).toBe(true);
  });
});

describe('icloudBackend.upload', () => {
  it('moves the snapshot natively and writes the sidecar', async () => {
    mockCloudStorage.uploadFile.mockResolvedValue(undefined);
    mockCloudStorage.writeFile.mockResolvedValue(undefined);

    await icloudBackend.upload('file:///cache/snapshot.veloqdb', METADATA);

    expect(mockCloudStorage.uploadFile).toHaveBeenCalledWith(
      `/Veloq/${FILENAME}`,
      '/cache/snapshot.veloqdb',
      { mimeType: 'application/octet-stream' }
    );
    const [sidecarPath, body] = mockCloudStorage.writeFile.mock.calls[0];
    expect(sidecarPath).toBe(`/Veloq/${FILENAME}.meta.json`);
    expect(JSON.parse(body).id).toBe(FILENAME);
  });

  it('creates the remote directory the first time', async () => {
    mockCloudStorage.exists.mockImplementation(async (path: string) => path !== '/Veloq');
    mockCloudStorage.mkdir.mockResolvedValue(undefined);
    mockCloudStorage.uploadFile.mockResolvedValue(undefined);
    mockCloudStorage.writeFile.mockResolvedValue(undefined);

    await icloudBackend.upload('/cache/snapshot.veloqdb', METADATA);

    expect(mockCloudStorage.mkdir).toHaveBeenCalledWith('/Veloq');
  });

  it('fails when the upload resolves but nothing landed', async () => {
    mockCloudStorage.uploadFile.mockResolvedValue(undefined);
    mockCloudStorage.exists.mockImplementation(async (path: string) => path === '/Veloq');

    const error = await icloudBackend.upload('/cache/snapshot.veloqdb', METADATA).catch((e) => e);

    expect(isBackupTransferError(error)).toBe(true);
    expect(error.kind).toBe('server');
    expect(mockCloudStorage.writeFile).not.toHaveBeenCalled();
  });

  it('fails when the sidecar cannot be written', async () => {
    mockCloudStorage.uploadFile.mockResolvedValue(undefined);
    mockCloudStorage.writeFile.mockRejectedValue(codedError('ERR_WRITE_ERROR'));

    const error = await icloudBackend.upload('/cache/snapshot.veloqdb', METADATA).catch((e) => e);

    expect(isBackupTransferError(error)).toBe(true);
    expect(error.kind).toBe('server');
  });
});

describe('icloudBackend.download', () => {
  it('syncs, clears the destination and downloads with an explicit scope', async () => {
    mockCloudStorage.downloadFile.mockResolvedValue(undefined);

    await icloudBackend.download(FILENAME, 'file:///cache/restore-temp.veloqdb');

    expect(mockCloudStorage.triggerSync).toHaveBeenCalledWith(`/Veloq/${FILENAME}`);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/restore-temp.veloqdb', {
      idempotent: true,
    });
    // Three arguments, otherwise the static overload silently syncs instead
    expect(mockCloudStorage.downloadFile).toHaveBeenCalledWith(
      `/Veloq/${FILENAME}`,
      '/cache/restore-temp.veloqdb',
      'documents'
    );
  });

  it('reports a missing remote file as a permanent path failure', async () => {
    mockCloudStorage.downloadFile.mockRejectedValue(codedError('ERR_FILE_NOT_FOUND'));

    const error = await icloudBackend.download(FILENAME, '/cache/out').catch((e) => e);

    expect(error.kind).toBe('path');
    expect(error.permanent).toBe(true);
  });
});

describe('icloudBackend.delete', () => {
  it('removes both the database and the sidecar', async () => {
    mockCloudStorage.unlink.mockResolvedValue(undefined);

    await icloudBackend.delete(FILENAME);

    expect(mockCloudStorage.unlink.mock.calls.map(([path]) => path)).toEqual([
      `/Veloq/${FILENAME}`,
      `/Veloq/${FILENAME}.meta.json`,
    ]);
  });

  it('stays best effort when the remote delete is refused', async () => {
    mockCloudStorage.unlink.mockRejectedValue(codedError('ERR_DELETE_ERROR'));

    await expect(icloudBackend.delete(FILENAME)).resolves.toBeUndefined();
  });
});
