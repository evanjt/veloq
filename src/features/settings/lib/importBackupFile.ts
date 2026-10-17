/**
 * Restore a backup file the athlete chose, whichever way it reached the app:
 * the import picker, or a file opened or shared into it. The record archive
 * and the supported legacy formats are told apart by name.
 */

import type { TFunction } from 'i18next';

import { importWaitsForSignIn, type DatabaseRestoreResult } from './backup';
import { confirmRestore, restoreCheckedFile } from './checkedRestore';
import { RESTORE_REFUSAL_KEYS, restoreRefusal, type RestoreRefusal } from './restoreRefusal';
import { discardHeldImport, holdImportWhileSignedOut, isHeldWhileSignedOut } from './heldImport';
import { inform } from '@/shared/ui/dialog';
import { showRestoreNotice } from './restoreNotice';

function informRefused(refusal: RestoreRefusal, t: TFunction): void {
  inform({ title: t('backup.notRestoredTitle'), message: t(RESTORE_REFUSAL_KEYS[refusal]) });
}

/**
 * Check, confirm and restore the file at `fileUri`, saying what became of it.
 * Resolves null when the athlete declined or the import failed, once the
 * failure has been reported. The caller still owns and deletes the file.
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
      return { success: false, refusal: 'signInRequired' };
    }

    // Signed out, the backup waits for the sign-in that lets it land. Holding
    // it runs the checks that need no engine, so the question comes after.
    if (await holdImportWhileSignedOut(fileUri, fileName)) {
      if (!(await confirmRestore(null, t))) {
        await discardHeldImport();
        return null;
      }
      showRestoreNotice('held', t);
      return { success: false };
    }

    const restored = await restoreCheckedFile(fileUri, fileName, t);
    if (restored === 'declined') return null;
    showRestoreNotice(restored, t);
    return { success: true, unplacedCount: restored.unplaced, drops: restored };
  } catch (error) {
    informRefused(restoreRefusal(error), t);
    // empty-on-error: the failure is the alert on the line above; null tells the caller the
    // import did not complete.
    return null;
  }
}
