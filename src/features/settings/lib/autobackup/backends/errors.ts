/**
 * Typed failures for backup transfers.
 *
 * The caller needs to know whether a failure will still be there tomorrow.
 * Wrong credentials or a full remote directory need the user to act, so they
 * are worth putting on the settings screen. A 5xx or a dropped connection is
 * not, because the next scheduled attempt will most likely succeed and a
 * standing "your backup is broken" would be a lie.
 */

export type BackupFailureKind = 'auth' | 'quota' | 'path' | 'server' | 'transport';

const PERMANENT_KINDS: readonly BackupFailureKind[] = ['auth', 'quota', 'path'];

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
  | 'backup.backupFailedQuota'
  | 'backup.backupFailedPath'
  | 'backup.backupFailedServer'
  | 'backup.backupFailedTransport';

const MESSAGE_KEYS: Record<BackupFailureKind, BackupFailureMessageKey> = {
  auth: 'backup.backupFailedAuth',
  quota: 'backup.backupFailedQuota',
  path: 'backup.backupFailedPath',
  server: 'backup.backupFailedServer',
  transport: 'backup.backupFailedTransport',
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

const CLOUD_STORAGE_KINDS: Record<string, BackupFailureKind> = {
  ERR_AUTHENTICATION_FAILED: 'auth',
  ERR_ACCESS_TOKEN_MISSING: 'auth',
  ERR_FILE_NOT_FOUND: 'path',
  ERR_DIRECTORY_NOT_FOUND: 'path',
  ERR_INVALID_SCOPE: 'path',
  ERR_INVALID_URL: 'path',
  ERR_PATH_IS_FILE: 'path',
  ERR_PATH_IS_DIRECTORY: 'path',
  ERR_NETWORK_ERROR: 'transport',
};

/**
 * Classify a CloudStorageError by its code.
 *
 * There is no quota code, so a full iCloud account arrives as a write error
 * and stays retryable. That errs towards silence, which is the safer side.
 */
export function cloudFailure(operation: string, cause: unknown): BackupTransferError {
  if (cause instanceof BackupTransferError) return cause;
  const raw = (cause as { code?: unknown } | null)?.code;
  const kind = (typeof raw === 'string' ? CLOUD_STORAGE_KINDS[raw] : undefined) ?? 'server';
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new BackupTransferError(operation, kind, `${operation} failed: ${detail}`);
}
