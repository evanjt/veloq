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
 * at any point costs a retry rather than a library.
 */

/** The main file first: it is the one whose presence says where the data is. */
export const ROUTE_DB_FILES = ['routes.db', 'routes.db-wal', 'routes.db-shm'] as const;

/** The file operations the move needs, so the decision is testable off a device. */
export interface RouteDbFileSystem {
  /** Bytes at `path`, or null when there is nothing there. */
  size(path: string): Promise<number | null>;
  copy(from: string, to: string): Promise<void>;
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
 * Move the database and its sidecars from `fromDir` to `toDir`, and answer
 * with the directory the engine should now open.
 *
 * Answering `fromDir` is not a failure to report upward: it means the old copy
 * is still the whole one, and opening it is correct. The next launch tries
 * again.
 */
export async function migrateRouteDb(
  fromDir: string,
  toDir: string,
  fs: RouteDbFileSystem
): Promise<string> {
  if (fromDir === toDir) return toDir;

  const sources = await Promise.all(ROUTE_DB_FILES.map((name) => fs.size(`${fromDir}${name}`)));
  if (sources[0] === null) return toDir;

  for (const [index, name] of ROUTE_DB_FILES.entries()) {
    const bytes = sources[index];
    // A sidecar the source no longer has is debris from an abandoned attempt.
    // Left in place it would be read as this database's journal, which it is not.
    if (bytes === null) {
      await fs.remove(`${toDir}${name}`).catch(() => undefined);
      continue;
    }
    try {
      await fs.copy(`${fromDir}${name}`, `${toDir}${name}`);
    } catch {
      return fromDir;
    }
    if ((await fs.size(`${toDir}${name}`)) !== bytes) return fromDir;
  }

  for (const [index, name] of ROUTE_DB_FILES.entries()) {
    if (sources[index] === null) continue;
    await fs.remove(`${fromDir}${name}`).catch(() => undefined);
  }
  return toDir;
}
