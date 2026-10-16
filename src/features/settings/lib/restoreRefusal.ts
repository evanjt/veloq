/**
 * Why a restore did not go in, as a word a screen words in the athlete's language.
 *
 * A restore fails in the engine, the legacy converter, the file system or this
 * side's own checks, and each throws its own English. Every surface that tells
 * the athlete reads the refusal from here, so no thrown message reaches an
 * alert or the backup row.
 */

import { engineErrorTag } from '@/shared/native/engineError';

export type RestoreRefusal =
  | 'signInRequired'
  | 'differentAccount'
  | 'missing'
  | 'unavailable'
  | 'failed';

export type RestoreRefusalKey =
  | 'backup.signInRequired'
  | 'backup.backupDifferentAccount'
  | 'backup.backupMissing'
  | 'backup.readerUnavailable'
  | 'backup.importError';

/** The locale key that words each refusal. */
export const RESTORE_REFUSAL_KEYS: Record<RestoreRefusal, RestoreRefusalKey> = {
  signInRequired: 'backup.signInRequired',
  differentAccount: 'backup.backupDifferentAccount',
  missing: 'backup.backupMissing',
  unavailable: 'backup.readerUnavailable',
  failed: 'backup.importError',
};

const DEVELOPER_MESSAGES: Record<RestoreRefusal, string> = {
  signInRequired: 'Sign in before importing a backup',
  differentAccount: 'Record belongs to another athlete',
  missing: 'Backup file is empty or missing',
  unavailable: 'Backup reader is unavailable',
  failed: 'Backup import failed',
};

/** A restore this side refused. The message is for the log; the refusal is for the screen. */
export class RestoreRefusedError extends Error {
  readonly refusal: RestoreRefusal;

  constructor(refusal: RestoreRefusal) {
    super(DEVELOPER_MESSAGES[refusal]);
    this.name = 'RestoreRefusedError';
    this.refusal = refusal;
  }
}

export function isRestoreRefusedError(error: unknown): error is RestoreRefusedError {
  return error instanceof RestoreRefusedError;
}

/**
 * The refusal behind anything a restore threw.
 *
 * The engine's two refusals carry no variant of their own, so they are read
 * from its message: "another athlete" crosses as `Database` and the signed-out
 * refusal as `NotFound`, and either would otherwise read as a failed database.
 */
export function restoreRefusal(error: unknown): RestoreRefusal {
  if (isRestoreRefusedError(error)) return error.refusal;
  const message = error instanceof Error ? error.message : '';
  if (message.includes('another athlete')) return 'differentAccount';
  if (message.includes('Sign in before importing')) return 'signInRequired';
  if (engineErrorTag(error) === 'NotInitialized') return 'signInRequired';
  return 'failed';
}
