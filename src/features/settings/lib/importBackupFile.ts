/**
 * Restore a backup file the athlete chose, whichever way it reached the app:
 * the import picker, or a file opened or shared into it. The record archive
 * and the supported legacy formats are told apart by name.
 */

import type { TFunction } from 'i18next';
import * as FileSystem from 'expo-file-system/legacy';

import {
  restoreBackup,
  RESTORE_REFUSAL_KEYS,
  restoreDatabaseBackup,
  restoreRecordBackup,
  importWaitsForSignIn,
  type DatabaseRestoreResult,
} from './backup';
import { holdImportWhileSignedOut, isHeldWhileSignedOut } from './heldImport';
import { confirmAction, inform } from '@/shared/ui/dialog';
import { showRestoreNotice } from './restoreNotice';

/** Ask before a backup replaces stored preferences and names. */
export function confirmLegacyImport(copy: {
  title: string;
  message: string;
  cancel: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    confirmAction({
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.title,
      cancelLabel: copy.cancel,
      destructive: true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * Confirm and restore the file at `fileUri`, saying what became of it. Resolves
 * null when the athlete declined or the import failed, once the failure has
 * been reported. The caller still owns and deletes the file.
 */
export async function importBackupFile(
  fileUri: string,
  fileName: string,
  t: TFunction
): Promise<DatabaseRestoreResult | null> {
  try {
    // An older backup picked signed out is held for sign-in below; anything else needs the engine now.
    if (importWaitsForSignIn() && !isHeldWhileSignedOut(fileName)) {
      inform({ title: t('backup.notRestoredTitle'), message: t('backup.signInRequired') });
      return { success: false, activityCount: 0, signInRequired: true };
    }

    const confirmed = await confirmLegacyImport({
      title: t('backup.importBackup'),
      message: t('backup.legacyImportMessage'),
      cancel: t('common.cancel'),
    });
    if (!confirmed) return null;

    // Signed out, an older backup waits for the sign-in that lets it land.
    if (await holdImportWhileSignedOut(fileUri, fileName)) {
      showRestoreNotice('held', t);
      return { success: false, activityCount: 0 };
    }

    // Auto-detect legacy .veloq JSON files
    if (fileName.endsWith('.veloq')) {
      const json = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const legacyResult = await restoreBackup(json);
      if (legacyResult.failed) {
        const message = legacyResult.signInRequired
          ? t('backup.signInRequired')
          : (legacyResult.error ?? t('backup.importError'));
        inform({ title: t('backup.notRestoredTitle'), message });
        return { success: false, activityCount: 0, error: legacyResult.error ?? message };
      }

      showRestoreNotice('restored', t);

      return {
        success: true,
        activityCount: 0,
      };
    }

    if (fileName.endsWith('.zip')) {
      await restoreRecordBackup(fileUri);
      showRestoreNotice('restored', t);
      return { success: true, activityCount: 0 };
    }

    const restoreResult = await restoreDatabaseBackup(fileUri);

    if (restoreResult.success) {
      showRestoreNotice('restored', t);
    } else {
      inform({
        title: t('backup.notRestoredTitle'),
        message: restoreResult.signInRequired
          ? t('backup.signInRequired')
          : restoreResult.athleteIdMismatch
            ? t('backup.backupDifferentAccount')
            : restoreResult.reason
              ? t(RESTORE_REFUSAL_KEYS[restoreResult.reason])
              : (restoreResult.error ?? t('backup.importError')),
      });
    }

    return restoreResult;
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('backup.importError');
    inform({ title: t('backup.notRestoredTitle'), message: msg });
    // empty-on-error: the failure is the alert on the line above; null tells the caller the
    // import did not complete.
    return null;
  }
}
