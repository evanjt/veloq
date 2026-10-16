/**
 * Typed failures for backup transfers.
 *
 * The caller needs to know whether a failure will still be there tomorrow.
 * Wrong credentials or a full remote directory need the user to act, so they
 * are worth putting on the settings screen. A 5xx or a dropped connection is
 * not, because the next scheduled attempt will most likely succeed and a
 * standing "your backup is broken" would be a lie. Neither is a copy the
 * carrier took that did not read back the same, `unverified`, which the next
 * trigger sends again. An address the athlete stored that may not carry the
 * credential, `address`, stays until they change it.
 */

export type BackupFailureKind =
  | 'auth'
  | 'signin'
  | 'quota'
  | 'path'
  | 'server'
  | 'transport'
  | 'folder_unavailable'
  | 'icloud_unavailable'
  | 'unverified'
  | 'address';

const PERMANENT_KINDS: readonly BackupFailureKind[] = [
  'address',
  'auth',
  'signin',
  'quota',
  'path',
  'folder_unavailable',
  'icloud_unavailable',
];

export class BackupTransferError extends Error {
  readonly kind: BackupFailureKind;
  readonly status: number | null;
  readonly operation: string;

  constructor(operation: string, kind: BackupFailureKind, message: string, status?: number) {
    super(message);
    this.name = 'BackupTransferError';
    this.operation = operation;
    this.kind = kind;
    this.status = status ?? null;
  }

  /** True when retrying without the user changing something will fail the same way. */
  get permanent(): boolean {
    return PERMANENT_KINDS.includes(this.kind);
  }

  /**
   * True when the carrier is still owed this run's copy. A failure that passes
   * on its own is retried by the next trigger. A lapsed sign-in waits for the
   * athlete, and the copy goes as soon as they sign in again rather than at
   * the next scheduled run.
   */
  get keepsCopyOwed(): boolean {
    return !this.permanent || this.kind === 'signin';
  }
}

export function isBackupTransferError(error: unknown): error is BackupTransferError {
  return error instanceof BackupTransferError;
}

/**
 * Map an HTTP status onto a failure kind.
 *
 * Anything in the 4xx range that is not recognised is treated as permanent,
 * because a malformed request repeated tomorrow is still malformed.
 */
export function classifyStatus(status: number): BackupFailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 413 || status === 507) return 'quota';
  if (status === 408 || status === 429) return 'server';
  if (status >= 500) return 'server';
  if (status >= 400) return 'path';
  return 'server';
}

export function transferFailure(
  operation: string,
  status: number,
  detail?: string
): BackupTransferError {
  const kind = classifyStatus(status);
  const suffix = detail ? `: ${detail}` : '';
  return new BackupTransferError(
    operation,
    kind,
    `${operation} failed (${status})${suffix}`,
    status
  );
}

export type BackupFailureMessageKey =
  | 'backup.backupFailedAuth'
  | 'backup.backupFailedSignIn'
  | 'backup.backupFailedQuota'
  | 'backup.backupFailedPath'
  | 'backup.backupFailedServer'
  | 'backup.backupFailedTransport'
  | 'backup.backupFailedFolder'
  | 'backup.backupFailedIcloud'
  | 'backup.backupFailedUnverified'
  | 'backup.backupFailedAddress';

const MESSAGE_KEYS: Record<BackupFailureKind, BackupFailureMessageKey> = {
  auth: 'backup.backupFailedAuth',
  signin: 'backup.backupFailedSignIn',
  quota: 'backup.backupFailedQuota',
  path: 'backup.backupFailedPath',
  server: 'backup.backupFailedServer',
  transport: 'backup.backupFailedTransport',
  folder_unavailable: 'backup.backupFailedFolder',
  icloud_unavailable: 'backup.backupFailedIcloud',
  unverified: 'backup.backupFailedUnverified',
  address: 'backup.backupFailedAddress',
};

/** Translation key describing a failure in terms of what the user can do about it. */
export function failureMessageKey(kind: BackupFailureKind): BackupFailureMessageKey {
  return MESSAGE_KEYS[kind];
}

/** Wrap a thrown network error, which is never a decision the server made. */
export function transportFailure(operation: string, cause: unknown): BackupTransferError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new BackupTransferError(operation, 'transport', `${operation} failed: ${detail}`);
}

/** A stored server address nothing may be sent to, which is never the server's decision. */
export function addressFailure(operation: string, problem: string): BackupTransferError {
  return new BackupTransferError(operation, 'address', `${operation} refused: address ${problem}`);
}
