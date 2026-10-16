/**
 * Scenario: an athlete restores a backup a destination lists. On the login
 * screen nobody is signed in, so the engine is closed and places no record.
 *
 * Expected behaviour: signed out, the downloaded file is held for the first
 * signed-in launch and the athlete is told so, and nothing reaches the engine.
 * Signed in, it is restored at once. Either way the downloaded copy is deleted.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { restoreBackendEntry } from '@/features/settings/lib/restoreBackendEntry';
import { holdImportWhileSignedOut } from '@/features/settings/lib/heldImport';
import { restoreDatabaseBackup, restoreRecordBackup } from '@/features/settings/lib/backup';
import type { BackupBackend, BackupEntry } from '@/features/settings/lib/autobackup';
import { transferFailure } from '@/features/settings/lib/autobackup/backends/errors';
import { describeBackupFailure } from '@/features/settings/lib/backupFailure';

const mockEngineState = { ready: false };

jest.mock('@/features/settings/lib/backup', () => ({
  restoreRecordBackup: jest.fn(async () => ({ placed: 1, unplaced: 0, missingActivityIds: [] })),
  restoreDatabaseBackup: jest.fn(async () => ({ success: true, activityCount: 0 })),
}));
jest.mock('@/features/settings/lib/heldImport', () => ({
  holdImportWhileSignedOut: jest.fn(async () => !mockEngineState.ready),
}));
jest.mock('@/shared/storage/cacheFiles', () => ({
  restoreCopyUri: async (name: string) => `file:///cache/restores/${name}`,
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  deleteAsync: jest.fn(async () => {}),
}));

const download = jest.fn(async (_id: string, _dest: string) => {});
const backend = { id: 'webdav', download } as unknown as BackupBackend;

function entry(id: string): BackupEntry {
  return { id, timestamp: '2026-10-01T08:00:00.000Z' } as BackupEntry;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngineState.ready = false;
});

describe.each(['veloq-2026-10-01.zip', 'veloq-2026-08-01.veloqdb'])('restoring %s', (id) => {
  it('signed out, holds the download for sign-in and restores nothing now', async () => {
    const outcome = await restoreBackendEntry(backend, entry(id));

    const [, dest] = download.mock.calls[0];
    expect(holdImportWhileSignedOut).toHaveBeenCalledWith(dest, id);
    expect(outcome).toBe('held');
    expect(restoreRecordBackup).not.toHaveBeenCalled();
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(dest, { idempotent: true });
  });

  it('signed in, restores it at once', async () => {
    mockEngineState.ready = true;

    const outcome = await restoreBackendEntry(backend, entry(id));

    expect(outcome).toBe('restored');
    const restored = id.endsWith('.zip') ? restoreRecordBackup : restoreDatabaseBackup;
    expect(restored).toHaveBeenCalledTimes(1);
  });
});

it('reports a file the hold refuses, and keeps nothing', async () => {
  (holdImportWhileSignedOut as jest.Mock).mockRejectedValueOnce(
    new Error('Invalid backup file format')
  );

  await expect(restoreBackendEntry(backend, entry('veloq-x.zip'))).rejects.toMatchObject({
    refusal: 'failed',
  });
  expect(restoreRecordBackup).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
});

describe('a refused restore', () => {
  beforeEach(() => {
    mockEngineState.ready = true;
  });

  it("is named by its refusal rather than the engine's English", async () => {
    (restoreRecordBackup as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('Record belongs to another athlete'), { tag: 'Database' })
    );

    const refused = restoreBackendEntry(backend, entry('veloq-2026-10-01.zip')).catch(
      (error: unknown) => error
    );

    expect(describeBackupFailure(await refused)).toEqual({
      kind: 'key',
      key: 'backup.backupDifferentAccount',
    });
  });

  it('carries the refusal a database restore reports', async () => {
    (restoreDatabaseBackup as jest.Mock).mockResolvedValueOnce({
      success: false,
      activityCount: 0,
      refusal: 'missing',
    });

    const refused = restoreBackendEntry(backend, entry('veloq-2026-08-01.veloqdb')).catch(
      (error: unknown) => error
    );

    expect(describeBackupFailure(await refused)).toEqual({
      kind: 'key',
      key: 'backup.backupMissing',
    });
  });

  it('keeps a failed download a transfer failure', async () => {
    download.mockRejectedValueOnce(transferFailure('Download backup', 401));

    const refused = restoreBackendEntry(backend, entry('veloq-2026-10-01.zip')).catch(
      (error: unknown) => error
    );

    expect(describeBackupFailure(await refused)).toEqual({
      kind: 'key',
      key: 'backup.backupFailedAuth',
    });
    expect(restoreRecordBackup).not.toHaveBeenCalled();
  });
});
