/**
 * The one order every restore follows: obtain the file, have the engine check
 * it the way the restore would, then ask, and restore only on that answer. A
 * file the check refuses is refused before any question, and the question
 * says what the backup holds, since consent to a replacement needs to know
 * what replaces what.
 */

import type { TFunction } from 'i18next';
import * as FileSystem from 'expo-file-system/legacy';

import { formatDateTime } from '@/shared/format/format';
import { restoreCopyUri } from '@/shared/storage/cacheFiles';
import { confirmAction } from '@/shared/ui/dialog';
import {
  SignInRequiredError,
  checkLegacyBackup,
  checkRecordBackup,
  convertLegacyDatabaseFile,
  importWaitsForSignIn,
  restoreBackup,
  restoreRecordBackup,
  type RestoreCheck,
} from './backup';
import { RestoreRefusedError } from './restoreRefusal';
import type { RestoreDrops } from './restoreNotice';

/** What a restore placed and what it gave up on. */
export interface CheckedRestoreOutcome extends RestoreDrops {
  unplaced: number;
}

/** A checked backup, restored only when `restore` is called. `release` deletes any copy it made. */
export interface CheckedBackup {
  check: RestoreCheck;
  restore: () => Promise<CheckedRestoreOutcome>;
  release: () => Promise<void>;
}

let convertedSequence = 0;

/**
 * Check the backup at `fileUri` as its restore would, writing nothing. The
 * kind is told by name: a record zip, an older `.veloq` file, or an older
 * database file, which is converted to a record zip first. Rejects with the
 * refusal the restore would give.
 */
export async function checkBackupFile(fileUri: string, fileName: string): Promise<CheckedBackup> {
  if (importWaitsForSignIn()) throw new SignInRequiredError();
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists || info.size === 0) throw new RestoreRefusedError('missing');

  if (fileName.endsWith('.zip')) {
    return {
      check: await checkRecordBackup(fileUri),
      restore: () => restoreRecordBackup(fileUri),
      release: async () => {},
    };
  }

  if (fileName.endsWith('.veloq')) {
    const json = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return {
      check: await checkLegacyBackup(json),
      restore: async () => {
        const restored = await restoreBackup(json);
        if ('refusal' in restored) throw new RestoreRefusedError(restored.refusal);
        return { ...restored.drops, unplaced: restored.unplacedCount };
      },
      release: async () => {},
    };
  }

  const recordUri = await restoreCopyUri(`restore-legacy-${Date.now()}-${++convertedSequence}.zip`);
  const release = () => FileSystem.deleteAsync(recordUri, { idempotent: true }).catch(() => {});
  try {
    await convertLegacyDatabaseFile(fileUri, recordUri);
    return {
      check: await checkRecordBackup(recordUri),
      restore: () => restoreRecordBackup(recordUri),
      release,
    };
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * Ask before a backup replaces stored settings and names, saying what it
 * holds. `check` is null for a backup held for sign-in, which the engine
 * cannot read until then.
 */
export function confirmRestore(check: RestoreCheck | null, t: TFunction): Promise<boolean> {
  const lines = check
    ? [
        check.writtenAt
          ? t('backup.checkedWritten', { date: formatDateTime(check.writtenAt) })
          : t('backup.checkedUndated'),
        t(check.namesAccount ? 'backup.checkedAccount' : 'backup.checkedNoAccount'),
        t('backup.checkedNames', { value: check.names }),
        t('backup.checkedSettings', { value: check.settings }),
        t('backup.checkedDecisions', { value: check.decisions }),
        '',
      ]
    : [];
  return new Promise((resolve) => {
    confirmAction({
      title: t('backup.importBackup'),
      message: [...lines, t('backup.legacyImportMessage')].join('\n'),
      confirmLabel: t('backup.replaceSettings'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * Check the backup at `fileUri`, ask, and restore it on the athlete's word.
 * Resolves `declined` when they decline, and rejects with the check's or the
 * restore's refusal. The caller still owns and deletes the file.
 */
export async function restoreCheckedFile(
  fileUri: string,
  fileName: string,
  t: TFunction
): Promise<CheckedRestoreOutcome | 'declined'> {
  const checked = await checkBackupFile(fileUri, fileName);
  try {
    if (!(await confirmRestore(checked.check, t))) return 'declined';
    return await checked.restore();
  } finally {
    await checked.release();
  }
}
