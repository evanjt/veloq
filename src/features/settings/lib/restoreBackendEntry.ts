/**
 * Restore one backup a destination lists: download it, route it by kind and
 * clean the copy up. A record zip goes through the record importer, a
 * database file through the database restore. Signed out, the engine places
 * no record, so the download is held for the first signed-in launch.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { restoreCopyUri } from '@/shared/storage/cacheFiles';
import type { BackupBackend, BackupEntry } from './autobackup';
import { isBackupTransferError } from './autobackup/backends/errors';
import { restoreDatabaseBackup, restoreRecordBackup } from './backup';
import { holdImportWhileSignedOut } from './heldImport';
import { RestoreRefusedError, restoreRefusal } from './restoreRefusal';
import type { RestoreOutcome } from './restoreNotice';

/**
 * Whether the backup went in or is held for sign-in. Rejects with the download's
 * transfer failure, or with a `RestoreRefusedError` naming why it did not go in.
 */
export async function restoreBackendEntry(
  backend: BackupBackend,
  entry: BackupEntry
): Promise<RestoreOutcome> {
  const destPath = await restoreCopyUri(
    `restore-selected-${Date.now()}${entry.id.endsWith('.zip') ? '.zip' : '.veloqdb'}`
  ).catch(() => {
    throw new RestoreRefusedError('failed');
  });
  try {
    await backend.download(entry.id, destPath);
    if (await holdImportWhileSignedOut(destPath, entry.id)) {
      return 'held';
    }
    if (entry.id.endsWith('.zip')) {
      await restoreRecordBackup(destPath);
    } else {
      const result = await restoreDatabaseBackup(destPath);
      if (!result.success) throw new RestoreRefusedError(result.refusal ?? 'failed');
    }
    return 'restored';
  } catch (error) {
    throw isBackupTransferError(error) ? error : new RestoreRefusedError(restoreRefusal(error));
  } finally {
    await FileSystem.deleteAsync(destPath, { idempotent: true }).catch(() => {});
  }
}
