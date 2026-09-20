import * as FileSystem from 'expo-file-system/legacy';

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

/** Copy `from` and whichever sidecars exist beside it to `to`. */
export async function copyDatabaseSet(from: string, to: string): Promise<void> {
  await FileSystem.copyAsync({ from: `file://${from}`, to: `file://${to}` });
  for (const suffix of DB_SIDECARS) {
    try {
      const beside = `file://${from}${suffix}`;
      if ((await FileSystem.getInfoAsync(beside)).exists) {
        await FileSystem.copyAsync({ from: beside, to: `file://${to}${suffix}` });
      }
    } catch {
      // A sibling that vanished under us is already gone from the set, which
      // is all the copy needs. The main file is what the caller waits on.
    }
  }
}

/** Remove whichever sidecars sit beside `path`, so none outlives its database. */
export async function clearDatabaseSidecars(path: string): Promise<void> {
  for (const suffix of DB_SIDECARS) {
    await FileSystem.deleteAsync(`file://${path}${suffix}`, { idempotent: true }).catch(() => {});
  }
}
