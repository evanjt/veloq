/**
 * Restore one backup a destination lists: download it, route it by kind and
 * clean the copy up. A record zip goes through the record importer, a
 * database file through the database restore. Signed out, the engine places
 * no record, so the download is held for the first signed-in launch.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { TFunction } from 'i18next';

import { restoreCopyUri } from '@/shared/storage/cacheFiles';
import type { BackupBackend, BackupEntry } from './autobackup';
import { RESTORE_REFUSAL_KEYS, restoreDatabaseBackup, restoreRecordBackup } from './backup';
import { holdImportWhileSignedOut } from './heldImport';

/** The alert a finished restore shows. */
export interface RestoredEntryNotice {
  title: string;
  message: string;
}

/** The alert to show on success. Throws with the message to show on failure. */
export async function restoreBackendEntry(
  backend: BackupBackend,
  entry: BackupEntry,
  t: TFunction
): Promise<RestoredEntryNotice> {
  const destPath = await restoreCopyUri(
    `restore-selected-${Date.now()}${entry.id.endsWith('.zip') ? '.zip' : '.veloqdb'}`
  ).catch(() => {
    throw new Error(t('backup.importError'));
  });
  try {
    await backend.download(entry.id, destPath);
    if (await holdImportWhileSignedOut(destPath, entry.id)) {
      return { title: t('backup.importBackup'), message: t('backup.heldUntilSignIn') };
    }
    if (entry.id.endsWith('.zip')) {
      await restoreRecordBackup(destPath);
    } else {
      const result = await restoreDatabaseBackup(destPath);
      if (result.athleteIdMismatch) {
        throw new Error(t('backup.backupDifferentAccount'));
      }
      if (result.reason) throw new Error(t(RESTORE_REFUSAL_KEYS[result.reason]));
      if (!result.success) throw new Error(result.error ?? t('backup.importError'));
    }
    return { title: t('backup.restoreComplete'), message: t('backup.recordRestored') };
  } catch (error) {
    throw error instanceof Error ? error : new Error(t('backup.importError'));
  } finally {
    await FileSystem.deleteAsync(destPath, { idempotent: true }).catch(() => {});
  }
}
