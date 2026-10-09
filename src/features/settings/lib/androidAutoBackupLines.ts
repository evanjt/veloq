/**
 * What the device row says about Android's Auto Backup, from the backup
 * agent's record rather than from when Veloq wrote its zip.
 *
 * Android drops a payload over its quota whole and says nothing, so an overrun
 * the latest backup has not got past is a failure the athlete is told about.
 * One a later backup got past is history, and is left out.
 */
import type { AndroidAutoBackupStatus } from '@/shared/native/androidAutoBackup';

export type AndroidAutoBackupLine =
  | { kind: 'never' }
  | { kind: 'backedUp'; at: number; bytes: number }
  | { kind: 'quotaExceeded'; at: number; bytes: number; quotaBytes: number }
  | { kind: 'restored'; at: number };

/** The lines in the order they are shown: the backup, then a failure, then a restore. */
export function androidAutoBackupLines(
  status: AndroidAutoBackupStatus | null
): AndroidAutoBackupLine[] {
  if (!status) return [];
  const lines: AndroidAutoBackupLine[] = [
    status.backedUpAt === null
      ? { kind: 'never' }
      : { kind: 'backedUp', at: status.backedUpAt, bytes: status.backedUpBytes ?? 0 },
  ];
  if (
    status.quotaExceededAt !== null &&
    (status.backedUpAt === null || status.quotaExceededAt > status.backedUpAt)
  ) {
    lines.push({
      kind: 'quotaExceeded',
      at: status.quotaExceededAt,
      bytes: status.quotaExceededBytes ?? 0,
      quotaBytes: status.quotaBytes ?? 0,
    });
  }
  if (status.restoredAt !== null) lines.push({ kind: 'restored', at: status.restoredAt });
  return lines;
}
