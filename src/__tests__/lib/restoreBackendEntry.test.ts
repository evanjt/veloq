/**
 * Scenario: an athlete restores a backup a destination lists. On the login
 * screen nobody is signed in, so the engine is closed and places no record.
 *
 * Expected behaviour: signed out, the downloaded file is held for the first
 * signed-in launch once the athlete agrees, and nothing reaches the engine.
 * Signed in, it is checked, asked about and restored. Either way the
 * downloaded copy is deleted.
 */

import * as FileSystem from 'expo-file-system/legacy';

import type { TFunction } from 'i18next';

import { restoreBackendEntry } from '@/features/settings/lib/restoreBackendEntry';
import { discardHeldImport, holdImportWhileSignedOut } from '@/features/settings/lib/heldImport';
import { confirmRestore, restoreCheckedFile } from '@/features/settings/lib/checkedRestore';
import type { BackupBackend, BackupEntry } from '@/features/settings/lib/autobackup';
import { transferFailure } from '@/features/settings/lib/autobackup/backends/errors';
import { describeBackupFailure } from '@/features/settings/lib/backupFailure';
import { RestoreRefusedError } from '@/features/settings/lib/restoreRefusal';

const mockEngineState = { ready: false };

jest.mock('@/features/settings/lib/checkedRestore', () => ({
  confirmRestore: jest.fn(async () => true),
  restoreCheckedFile: jest.fn(async () => ({
    unplaced: 0,
    notRestored: 0,
    namesNotRestored: 19,
  })),
}));
jest.mock('@/features/settings/lib/heldImport', () => ({
  holdImportWhileSignedOut: jest.fn(async () => !mockEngineState.ready),
  discardHeldImport: jest.fn(async () => {}),
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

const t = ((key: string) => key) as unknown as TFunction;

function entry(id: string): BackupEntry {
  return { id, timestamp: '2026-10-01T08:00:00.000Z' } as BackupEntry;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngineState.ready = false;
});

describe.each(['veloq-2026-10-01.zip', 'veloq-2026-08-01.veloqdb'])('restoring %s', (id) => {
  it('signed out, holds the download for sign-in and restores nothing now', async () => {
    const outcome = await restoreBackendEntry(backend, entry(id), t);

    const [, dest] = download.mock.calls[0];
    expect(holdImportWhileSignedOut).toHaveBeenCalledWith(dest, id);
    expect(outcome).toBe('held');
    expect(confirmRestore).toHaveBeenCalledWith(null, t);
    expect(restoreCheckedFile).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(dest, { idempotent: true });
  });

  it('signed out and declined, keeps nothing held', async () => {
    jest.mocked(confirmRestore).mockResolvedValueOnce(false);

    expect(await restoreBackendEntry(backend, entry(id), t)).toBe('declined');
    expect(discardHeldImport).toHaveBeenCalledTimes(1);
    expect(restoreCheckedFile).not.toHaveBeenCalled();
  });

  it('signed in, restores it at once and says what it gave up on', async () => {
    mockEngineState.ready = true;

    const outcome = await restoreBackendEntry(backend, entry(id), t);

    expect(outcome).toMatchObject({ notRestored: 0, namesNotRestored: 19 });
    const [, dest] = download.mock.calls[0];
    expect(restoreCheckedFile).toHaveBeenCalledWith(dest, dest, t);
    expect(dest.endsWith(id.endsWith('.zip') ? '.zip' : '.veloqdb')).toBe(true);
  });
});

it('reports a file the hold refuses, and keeps nothing', async () => {
  (holdImportWhileSignedOut as jest.Mock).mockRejectedValueOnce(
    new Error('Invalid backup file format')
  );

  await expect(restoreBackendEntry(backend, entry('veloq-x.zip'), t)).rejects.toMatchObject({
    refusal: 'failed',
  });
  expect(confirmRestore).not.toHaveBeenCalled();
  expect(restoreCheckedFile).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
});

describe('a refused restore', () => {
  beforeEach(() => {
    mockEngineState.ready = true;
  });

  it("is named by its refusal rather than the engine's English", async () => {
    jest
      .mocked(restoreCheckedFile)
      .mockRejectedValueOnce(
        Object.assign(new Error('Record belongs to another athlete'), { tag: 'Database' })
      );

    const refused = restoreBackendEntry(backend, entry('veloq-2026-10-01.zip'), t).catch(
      (error: unknown) => error
    );

    expect(describeBackupFailure(await refused)).toEqual({
      kind: 'key',
      key: 'backup.backupDifferentAccount',
    });
  });

  it('carries the refusal the check of a database file reports', async () => {
    jest.mocked(restoreCheckedFile).mockRejectedValueOnce(new RestoreRefusedError('missing'));

    const refused = restoreBackendEntry(backend, entry('veloq-2026-08-01.veloqdb'), t).catch(
      (error: unknown) => error
    );

    expect(describeBackupFailure(await refused)).toEqual({
      kind: 'key',
      key: 'backup.backupMissing',
    });
  });

  it('keeps a failed download a transfer failure', async () => {
    download.mockRejectedValueOnce(transferFailure('Download backup', 401));

    const refused = restoreBackendEntry(backend, entry('veloq-2026-10-01.zip'), t).catch(
      (error: unknown) => error
    );

    expect(describeBackupFailure(await refused)).toEqual({
      kind: 'key',
      key: 'backup.backupFailedAuth',
    });
    expect(restoreCheckedFile).not.toHaveBeenCalled();
  });
});
