/**
 * The name a run's zip takes on a carrier that keeps files by name, and the
 * instant read back out of it.
 */

/** `veloq-2026-03-14T06-30-00-000Z.zip`: the run's instant with no character a file system refuses. */
const BACKUP_NAME = /^veloq-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.zip$/;

/** The name a run's zip takes, from the run's ISO timestamp. */
export function backupFileName(timestamp: string): string {
  const at = new Date(timestamp);
  const iso = (Number.isNaN(at.getTime()) ? new Date() : at).toISOString();
  return `veloq-${iso.replace(/[:.]/g, '-')}.zip`;
}

/** The ISO instant a run's zip name carries, or null for any other file. */
export function backupNameTimestamp(name: string): string | null {
  const m = BACKUP_NAME.exec(name);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}
