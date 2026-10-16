/**
 * What the backup row says about a failure.
 *
 * Three kinds arrive here and they were nearly one. A transfer the backend
 * rejected has its own kind and its own line. An engine failure crosses as a
 * typed variant, and its `message` is Rust's own English, so it was being
 * rendered untranslated: the variant is what the athlete can be told in their
 * own language, and "the engine is not open yet" is a different instruction
 * from "the database refused". A restore that did not go in carries its
 * refusal, which is worded the same way. Anything else is a plain `Error`
 * whose message is the best that is known.
 */
import {
  failureMessageKey,
  isBackupTransferError,
  type BackupFailureMessageKey,
} from '@/features/settings/lib/autobackup/backends/errors';
import {
  isRestoreRefusedError,
  RESTORE_REFUSAL_KEYS,
  type RestoreRefusalKey,
} from '@/features/settings/lib/restoreRefusal';
import { engineErrorKey, engineErrorTag, type EngineFailureKey } from '@/shared/native/engineError';

export type BackupFailureDescription =
  | {
      kind: 'key';
      key:
        | BackupFailureMessageKey
        | RestoreRefusalKey
        | EngineFailureKey
        | 'backup.backupFailedMessage';
    }
  | { kind: 'message'; message: string };

export function describeBackupFailure(error: unknown): BackupFailureDescription {
  if (isBackupTransferError(error)) return { kind: 'key', key: failureMessageKey(error.kind) };
  if (isRestoreRefusedError(error))
    return { kind: 'key', key: RESTORE_REFUSAL_KEYS[error.refusal] };
  if (engineErrorTag(error)) {
    return { kind: 'key', key: engineErrorKey(error, 'backup.backupFailedMessage') };
  }
  if (error instanceof Error && error.message) return { kind: 'message', message: error.message };
  return { kind: 'key', key: 'backup.backupFailedMessage' };
}
