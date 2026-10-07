import * as FileSystem from 'expo-file-system/legacy';

import { recordCrashes } from '@/shared/debug/crashLog';
import { excludeExistingFromBackup } from '@/shared/native/backupExclusion';
import { DISPLACED_INFIX, panicLogPath } from '@/shared/storage/routeDbLocation';

/**
 * A database is three files, not one. SQLite applies a `-wal` it finds beside a
 * database on the next open, so a copy that names only the main file can leave
 * one belonging to the file it just replaced.
 *
 * Closing the engine first is not enough on its own: a clean close deletes the
 * pair, but only for the last connection, and the backup source
 * (`persistence/export.rs`) and the detection worker each hold one on a
 * background thread. Quarantine already moves all three together
 * (`persistence/mod.rs`), and this is the same shape on the restore side.
 */
export const DB_SIDECARS = ['-wal', '-shm'] as const;

/** Remove whichever sidecars sit beside `path`, so none outlives its database. */
export async function clearDatabaseSidecars(path: string): Promise<void> {
  for (const suffix of DB_SIDECARS) {
    await FileSystem.deleteAsync(`file://${path}${suffix}`, { idempotent: true }).catch(() => {});
  }
}

/**
 * What the engine's quarantine puts between a database's name and the time it
 * moved it aside: `routes.db.corrupt-<seconds>`, with its own `-wal` and `-shm`
 * (`reopen_after_quarantine` in `persistence/mod.rs`).
 */
export const QUARANTINE_INFIX = '.corrupt-';

/**
 * Every copy of the library set aside beside `dbPath` and its pair, as file
 * URIs: each quarantined generation, and each library the move into the App
 * Group found at its target and moved aside. A directory that is not there
 * holds none.
 */
export async function setAsideCopies(dbPath: string): Promise<string[]> {
  const slash = dbPath.lastIndexOf('/');
  const dir = `file://${dbPath.slice(0, slash + 1)}`;
  const prefixes = [QUARANTINE_INFIX, DISPLACED_INFIX].map(
    (infix) => `${dbPath.slice(slash + 1)}${infix}`
  );
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
    .map((name) => `${dir}${name}`);
}

/**
 * Delete every copy of the library set aside beside `dbPath`, and its pair.
 *
 * Launch keeps a quarantined one so the salvage can read what it missed, and
 * only the next quarantine removes it. Nothing removes a displaced one. Either
 * is a whole copy of a library that would otherwise outlive the athlete it
 * belongs to.
 */
export async function deleteSetAsideCopies(dbPath: string): Promise<void> {
  const copies = await setAsideCopies(dbPath);
  await Promise.all(copies.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true })));
}

/**
 * Keep every copy of the library set aside beside `dbPath` out of the device
 * backup.
 *
 * Each is a whole library beside the live one, so on iOS, where the database's
 * directory rides in the iCloud backup, it would put a second library into
 * every backup. The attribute lives on the file, and a quarantine or a move
 * makes a new one, so this runs after every open.
 */
export async function excludeSetAsideCopies(dbPath: string): Promise<void> {
  for (const uri of await setAsideCopies(dbPath)) {
    if (excludeExistingFromBackup(uri) === false) {
      console.warn('[sidecars] set-aside copy is not excluded from the device backup:', uri);
    }
  }
}

/** Delete the panic log in the directory that holds `dbPath`. */
export async function deletePanicLog(dbPath: string): Promise<void> {
  await FileSystem.deleteAsync(`file://${panicLogPath(dbPath)}`, { idempotent: true });
}

/** The crash log keeps this many entries, so older panic lines would be shifted out at once. */
const MAX_PANIC_LINES = 20;

/**
 * Move the panic log's lines into the shared crash log, then empty the file once they are stored.
 *
 * A panic on a background thread reaches no JavaScript handler, so the hook's
 * file is its only record and nothing else reads it. The file is emptied and not
 * deleted, and marked again, so the hook keeps appending to the inode that
 * carries the backup mark. It is kept whole when it
 * cannot be read or the lines cannot be stored, so a later launch tries again. Never throws.
 */
export async function recoverPanicLog(dbPath: string): Promise<void> {
  try {
    const uri = `file://${panicLogPath(dbPath)}`;
    if (!(await FileSystem.getInfoAsync(uri)).exists) return;
    const lines = (await FileSystem.readAsStringAsync(uri))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-MAX_PANIC_LINES);
    await recordCrashes(lines.map((message) => ({ source: 'rust-panic', fatal: true, message })));
    await FileSystem.writeAsStringAsync(uri, '');
    excludeExistingFromBackup(uri);
  } catch {
    // Recovering a record must never fail a launch.
  }
}
