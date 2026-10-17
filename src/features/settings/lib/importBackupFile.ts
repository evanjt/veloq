/**
 * Restore a backup file the athlete chose, whichever way it reached the app:
 * the import picker, or a file opened or shared into it. The record archive
 * and the supported legacy formats are told apart by name.
 */

import type { TFunction } from 'i18next';
import * as FileSystem from 'expo-file-system/legacy';

import {
  restoreBackup,
  restoreDatabaseBackup,
  restoreRecordBackup,
  importWaitsForSignIn,
  type DatabaseRestoreResult,
} from './backup';
import { RESTORE_REFUSAL_KEYS, restoreRefusal, type RestoreRefusal } from './restoreRefusal';
import { holdImportWhileSignedOut, isHeldWhileSignedOut } from './heldImport';
import { confirmAction, inform } from '@/shared/ui/dialog';
import { showRestoreNotice } from './restoreNotice';

function informRefused(refusal: RestoreRefusal, t: TFunction): void {
  inform({ title: t('backup.notRestoredTitle'), message: t(RESTORE_REFUSAL_KEYS[refusal]) });
}

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
      informRefused('signInRequired', t);
      return { success: false, activityCount: 0, refusal: 'signInRequired' };
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
      if ('refusal' in legacyResult) {
        informRefused(legacyResult.refusal, t);
        return { success: false, activityCount: 0, refusal: legacyResult.refusal };
      }

      showRestoreNotice(legacyResult.drops, t);

      return {
        success: true,
        activityCount: 0,
        unplacedCount: legacyResult.unplacedCount,
        drops: legacyResult.drops,
      };
    }

    if (fileName.endsWith('.zip')) {
      const restored = await restoreRecordBackup(fileUri);
      showRestoreNotice(restored, t);
      return { success: true, activityCount: 0, unplacedCount: restored.unplaced, drops: restored };
    }

    const restoreResult = await restoreDatabaseBackup(fileUri);

    if (restoreResult.success) {
      showRestoreNotice(restoreResult.drops, t);
    } else {
      informRefused(restoreResult.refusal ?? 'failed', t);
    }

    return restoreResult;
  } catch (error) {
    informRefused(restoreRefusal(error), t);
    // empty-on-error: the failure is the alert on the line above; null tells the caller the
    // import did not complete.
    return null;
  }
}
