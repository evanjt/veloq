/**
 * Scenario: a backup destination rejects the upload.
 * Expected behaviour: the last-backup timestamp stays where it was, so the 24h
 * throttle cannot hide a failure for a day, and a failure the user has to act
 * on is kept for the settings screen to read.
 */

import {
  performBackup,
  registerBackend,
  getLastBackupTimestamp,
  getLastBackupFailure,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';
import {
  transferFailure,
  transportFailure,
} from '@/features/settings/lib/autobackup/backends/errors';

const mockSettings = new Map<string, string>();

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    backupDatabase: jest.fn(),
    getBackupMetadata: () => ({
      schema_version: '14',
      activity_count: '312',
      athlete_id: 'i12345',
    }),
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

const upload = jest.fn();

const testBackend: BackupBackend = {
  id: 'test-remote',
  name: 'Test Remote',
  isAvailable: async () => true,
  listBackups: async () => [],
  upload: (localPath, metadata) => upload(localPath, metadata),
  download: async () => {},
  delete: async () => {},
};

registerBackend(testBackend);

beforeEach(() => {
  mockSettings.clear();
  mockSettings.set('__backup_backend', 'test-remote');
  upload.mockReset();
});

describe('performBackup', () => {
  it('leaves the last-backup timestamp alone when the upload is rejected', async () => {
    upload.mockRejectedValue(transferFailure('Upload backup', 401));

    await expect(performBackup(true)).rejects.toThrow();

    expect(getLastBackupTimestamp()).toBeNull();
    expect(getLastBackupFailure()).toMatchObject({ kind: 'auth', status: 401 });
  });

  it('does not overwrite an older timestamp on a later failure', async () => {
    mockSettings.set('__last_auto_backup', '1000');
    upload.mockRejectedValue(transferFailure('Upload backup', 507));

    await expect(performBackup(true)).rejects.toThrow();

    expect(getLastBackupTimestamp()).toBe(1000);
    expect(getLastBackupFailure()?.kind).toBe('quota');
  });

  it('keeps quiet about a transient failure', async () => {
    upload.mockRejectedValue(transportFailure('Upload backup', new Error('socket hang up')));

    await expect(performBackup(true)).rejects.toThrow();

    expect(getLastBackupFailure()).toBeNull();
  });

  it('records the timestamp and clears a standing failure on success', async () => {
    mockSettings.set('__last_backup_failure', JSON.stringify({ kind: 'auth', status: 401, at: 5 }));
    upload.mockResolvedValue(undefined);

    await expect(performBackup(true)).resolves.toBe(true);

    expect(getLastBackupTimestamp()).toBeGreaterThan(0);
    expect(getLastBackupFailure()).toBeNull();
  });
});
