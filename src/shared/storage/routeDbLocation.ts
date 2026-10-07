/**
 * Where `routes.db` lives, and the one-time move that puts it there.
 *
 * Every released build opened the database under `FileSystem.documentDirectory`.
 * An iOS Notification Service Extension is a separate process with no reach
 * into the app's Documents, so the file has to sit in the App Group container
 * both targets already declare. Android has no such container and stays where
 * it is, which is also what `with-android-backup.js` names by `domain="file"`.
 *
 * The move is copy, verify, delete rather than a rename. A rename that dies
 * halfway leaves the set split across two directories with nothing saying
 * which half is authoritative, and the set is three files rather than one,
 * because the journal mode is WAL. Copying first means the old directory stays
 * whole and authoritative until a copy of the same size reads back, so a crash
 * before removing the old main file costs a retry rather than a library.
 */

import { debug } from '@/shared/debug/debug';
import { excludeExistingFromBackup } from '@/shared/native/backupExclusion';

/** The main file first: it is the one whose presence says where the data is. */
export const ROUTE_DB_FILES = ['routes.db', 'routes.db-wal', 'routes.db-shm'] as const;

/**
 * The database at `dbPath` and its two sidecars, which is the set an
 * attribute on one file has to be put on: SQLite recreates a sidecar it
 * deleted, and the attribute belongs to the file and not to its name.
 */
export function routeDbFilePaths(dbPath: string): string[] {
  const base = dbPath.slice(0, dbPath.length - ROUTE_DB_FILES[0].length);
  return ROUTE_DB_FILES.map((name) => `${base}${name}`);
}

/**
 * The file the engine's panic hook appends to, beside the database
 * (`install_panic_hook` in `persistence/mod.rs`). A panic message can name an
 * activity or a section.
 */
export const PANIC_LOG_NAME = 'veloq_panic.log';

/** The panic log beside `dbPath`. */
export function panicLogPath(dbPath: string): string {
  return `${dbPath.slice(0, dbPath.lastIndexOf('/') + 1)}${PANIC_LOG_NAME}`;
}

/**
 * Leave an empty panic log beside `dbPath` if there is none. The hook creates
 * and appends to the same inode, so one that already carries the backup mark
 * keeps it. Never throws: a log that cannot be made is simply made by the hook.
 */
function ensurePanicLog(dbPath: string): void {
  try {
    // Loaded here because the native File class is only defined where the module is.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const file = new File(`file://${panicLogPath(dbPath)}`);
    if (!file.exists) file.create();
  } catch (error) {
    console.warn('[RouteDb] could not create the panic log:', error);
  }
}

/**
 * Open the library at `dbPath` and keep what the open created, and the panic
 * log beside it, out of the iOS device backup, which is the one place the engine's database is opened.
 *
 * The open is what creates the database and its journal files, and SQLite
 * recreates a sidecar it deleted, so the attribute is put on after every open
 * and not once at launch. A library opened after launch (a first sign-in, an
 * identity wipe, a snapshot rollback) would otherwise stay in the backup until
 * the next cold start. A file that did not take the mark is warned about and
 * the open's result is returned regardless.
 */
export function openLibrary(
  engine: { initWithPath(path: string): boolean },
  dbPath: string
): boolean {
  const opened = engine.initWithPath(dbPath);
  if (!opened) return false;
  ensurePanicLog(dbPath);
  for (const file of [...routeDbFilePaths(dbPath), panicLogPath(dbPath)]) {
    if (excludeExistingFromBackup(file) === false) {
      console.warn(`[RouteDb] ${file} is not excluded from the device backup`);
    }
  }
  return true;
}

/** The file operations the move needs, so the decision is testable off a device. */
export interface RouteDbFileSystem {
  /** Bytes at `path`, or null when there is nothing there. */
  size(path: string): Promise<number | null>;
  copy(from: string, to: string): Promise<void>;
  /** Rename `from` to `to`, refusing when `to` already exists. */
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/**
 * The directory the database should be opened from. The App Group wins when
 * there is one, which on iOS is always and on Android is never.
 */
export function routeDbDirectory(appGroupDir: string | null, documentDir: string): string {
  return appGroupDir ?? documentDir;
}

/**
 * What goes between the database's name and the time a library found at the
 * target was moved aside: `routes.db.displaced-<stamp>`, with its own `-wal`
 * and `-shm`. A wipe takes these, as it takes quarantined copies.
 */
export const DISPLACED_INFIX = '.displaced-';

/**
 * Where a library already at the target goes, beside it in the same directory.
 * The main file keeps SQLite's sidecar naming, so the set still opens as one.
 */
function displacedName(name: string, stamp: string): string {
  return name.replace(ROUTE_DB_FILES[0], `${ROUTE_DB_FILES[0]}${DISPLACED_INFIX}${stamp}`);
}

/**
 * Move the database and its sidecars from `fromDir` to `toDir`, and answer
 * with the directory the engine should now open.
 *
 * Answering `fromDir` is not a failure to report upward: it means the old copy
 * is still the whole one, and opening it is correct. The next launch tries
 * again.
 *
 * A database already at `toDir` is not this move's to overwrite: the App Group
 * container is shared by both app identities, and a crash after an earlier
 * copy leaves one there too. It is moved aside under a dated name before the
 * copy and moved back if the move gives up. What this deletes at `toDir` is
 * only its own copy when it gives up, and a lone sidecar with no database
 * beside it.
 */
export async function migrateRouteDb(
  fromDir: string,
  toDir: string,
  fs: RouteDbFileSystem,
  stamp: string = new Date().toISOString().replace(/[-:.]/g, '')
): Promise<string> {
  if (fromDir === toDir) return toDir;

  const sources = await Promise.all(ROUTE_DB_FILES.map((name) => fs.size(`${fromDir}${name}`)));
  if (sources[0] === null) return toDir;

  const displaced: string[] = [];
  const written: string[] = [];
  const giveUp = async () => {
    for (const name of written) {
      await fs.remove(`${toDir}${name}`).catch(() => undefined);
    }
    for (const name of displaced.reverse()) {
      await fs.move(`${toDir}${displacedName(name, stamp)}`, `${toDir}${name}`);
    }
    return fromDir;
  };

  if ((await fs.size(`${toDir}${ROUTE_DB_FILES[0]}`)) !== null) {
    try {
      for (const name of ROUTE_DB_FILES) {
        if ((await fs.size(`${toDir}${name}`)) === null) continue;
        await fs.move(`${toDir}${name}`, `${toDir}${displacedName(name, stamp)}`);
        displaced.push(name);
      }
    } catch {
      return giveUp();
    }
    debug.warn(
      `[RouteDb] A database was already at ${toDir}, moved aside as ${displacedName(ROUTE_DB_FILES[0], stamp)}`
    );
  }

  for (const [index, name] of ROUTE_DB_FILES.entries()) {
    const bytes = sources[index];
    // Any database at the target has been moved aside with its pair, so a
    // sidecar still here that the source no longer has is debris from an
    // abandoned attempt. Left in place it would be read as this database's
    // journal, which it is not.
    if (bytes === null) {
      await fs.remove(`${toDir}${name}`).catch(() => undefined);
      continue;
    }
    written.push(name);
    try {
      await fs.copy(`${fromDir}${name}`, `${toDir}${name}`);
    } catch {
      return giveUp();
    }
    if ((await fs.size(`${toDir}${name}`)) !== bytes) return giveUp();
  }

  // The old main file is the authority marker. If it cannot be removed,
  // continue opening Documents so later writes are included on the next copy.
  // Remove the rejected copy so no reader treats it as the moved library.
  try {
    await fs.remove(`${fromDir}${ROUTE_DB_FILES[0]}`);
  } catch {
    return giveUp();
  }
  for (const [index, name] of ROUTE_DB_FILES.entries()) {
    if (index === 0 || sources[index] === null) continue;
    await fs.remove(`${fromDir}${name}`).catch(() => undefined);
  }
  return toDir;
}
