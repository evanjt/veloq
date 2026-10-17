/**
 * The name a record zip takes wherever it is kept by name, the share sheet's
 * copy and every carrier's alike, and the instant read back out of it.
 *
 * A folder the athlete picks is theirs, so a zip they saved into it by hand
 * counts as much as one a run wrote. The listing therefore reads every name a
 * record zip has ever been given, not only the one written now.
 */

/** What every record zip name starts with. */
export const BACKUP_NAME_PREFIX = 'veloq-backup-';

/** ` (1)`: the suffix a file manager adds when a second copy lands under a taken name. */
const COPY = String.raw`(?: \(\d+\))?`;

/** `veloq-backup-2026-03-14-073005.zip`: the local date and time, to the second. */
const LOCAL_NAME = new RegExp(
  String.raw`^veloq-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})${COPY}\.zip$`
);

/** `veloq-backup-2026-03-14.zip`: the local date an older share sheet copy took. */
const DATED_NAME = new RegExp(String.raw`^veloq-backup-(\d{4})-(\d{2})-(\d{2})${COPY}\.zip$`);

/** `veloq-2026-03-14T06-30-00-000Z.zip`: the UTC instant an older automatic run took. */
const INSTANT_NAME = new RegExp(
  String.raw`^veloq-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z${COPY}\.zip$`
);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The name a record zip takes, from the ISO timestamp it was written at. */
export function backupFileName(timestamp: string): string {
  const parsed = new Date(timestamp);
  const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${BACKUP_NAME_PREFIX}${date}-${time}.zip`;
}

/**
 * The ISO instant of a local wall-clock time, or null when the fields name no
 * date. A time a clock change skipped still lists, at the instant it shifts to.
 */
function localInstant(parts: string[]): string | null {
  const [y = NaN, mo = NaN, d = NaN, h = 0, mi = 0, s = 0] = parts.map(Number);
  if (h > 23 || mi > 59 || s > 59) return null;
  const at = new Date(y, mo - 1, d, h, mi, s);
  const day = new Date(y, mo - 1, d, 12);
  const exists = day.getFullYear() === y && day.getMonth() === mo - 1 && day.getDate() === d;
  return exists ? at.toISOString() : null;
}

/** The ISO instant a record zip's name carries, or null for any other file. */
export function backupNameTimestamp(name: string): string | null {
  const local = LOCAL_NAME.exec(name) ?? DATED_NAME.exec(name);
  if (local) return localInstant(local.slice(1));
  const m = INSTANT_NAME.exec(name);
  if (!m) return null;
  const at = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
