/**
 * Restore one backup a destination lists: download it, check it, ask, restore
 * it and clean the copy up. Signed out, the engine places no record, so the
 * download is held for the first signed-in launch.
 */

import type { TFunction } from 'i18next';
import * as FileSystem from 'expo-file-system/legacy';

import { restoreCopyUri } from '@/shared/storage/cacheFiles';
import type { BackupBackend, BackupEntry } from './autobackup';
import { isBackupTransferError } from './autobackup/backends/errors';
import { confirmRestore, restoreCheckedFile } from './checkedRestore';
import { discardHeldImport, holdImportWhileSignedOut } from './heldImport';
import { RestoreRefusedError, restoreRefusal } from './restoreRefusal';
import type { RestoreOutcome } from './restoreNotice';

/**
 * Whether the backup is held for sign-in, what it gave up on once it went in,
 * or `declined` when the athlete said no. Rejects with the download's transfer
 * failure, or with a `RestoreRefusedError` naming why it did not go in.
 */
export async function restoreBackendEntry(
  backend: BackupBackend,
  entry: BackupEntry,
  t: TFunction
): Promise<RestoreOutcome | 'declined'> {
  const destPath = await restoreCopyUri(
    `restore-selected-${Date.now()}${entry.id.endsWith('.zip') ? '.zip' : '.veloqdb'}`
  ).catch(() => {
    throw new RestoreRefusedError('failed');
  });
  try {
    await backend.download(entry.id, destPath);
    if (await holdImportWhileSignedOut(destPath, entry.id)) {
      if (await confirmRestore(null, t)) return 'held';
      await discardHeldImport();
      return 'declined';
    }
    // The copy's name carries the kind the entry's name gave it.
    return await restoreCheckedFile(destPath, destPath, t);
  } catch (error) {
    throw isBackupTransferError(error) ? error : new RestoreRefusedError(restoreRefusal(error));
  } finally {
    await FileSystem.deleteAsync(destPath, { idempotent: true }).catch(() => {});
  }
}
