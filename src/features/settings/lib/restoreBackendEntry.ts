/**
 * Restore one backup a destination lists: download it, route it by kind and
 * clean the copy up. A record zip goes through the record importer, a
 * database file through the database restore.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { TFunction } from 'i18next';

import { restoreCopyUri } from '@/shared/storage/cacheFiles';
import type { BackupBackend, BackupEntry } from './autobackup';
import { RESTORE_REFUSAL_KEYS, restoreDatabaseBackup, restoreRecordBackup } from './backup';

/** The lines to show on success. Throws with the message to show on failure. */
export async function restoreBackendEntry(
  backend: BackupBackend,
  entry: BackupEntry,
  t: TFunction
): Promise<string[]> {
  const destPath = await restoreCopyUri(
    `restore-selected-${Date.now()}${entry.id.endsWith('.zip') ? '.zip' : '.veloqdb'}`
  ).catch(() => {
    throw new Error(t('backup.importError'));
  });
  try {
    await backend.download(entry.id, destPath);
    const messages = [t('backup.recordRestored')];
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
    return messages;
  } catch (error) {
    throw error instanceof Error ? error : new Error(t('backup.importError'));
  } finally {
    await FileSystem.deleteAsync(destPath, { idempotent: true }).catch(() => {});
  }
}
