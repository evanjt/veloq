/**
 * The record zip the platform's own device backup carries.
 *
 * Auto-backup writes it into the documents directory on every run, and the
 * Android backup rules name that one file, so a new phone set up from the
 * athlete's device backup finds it there before anything else has run.
 */

import * as FileSystem from 'expo-file-system/legacy';

export const PLATFORM_RECORD_FILE = 'veloq-decisions.zip';

/** Its URI, or null where the platform gives no documents directory. */
export function platformRecordUri(): string | null {
  const docDir = FileSystem.documentDirectory;
  return docDir ? `${docDir}${PLATFORM_RECORD_FILE}` : null;
}

/**
 * What the engine names the temporary file a record zip is written into, and
 * the directory an older library is converted in, each beside its destination
 * (`RECORD_TEMP_PREFIX` in `record_backup.rs`). A kill before the rename leaves
 * one behind holding the athlete's record, or a whole older library.
 */
export const RECORD_TEMP_PREFIX = 'veloq-record-';

/**
 * Delete every record temporary a kill left in the documents directory.
 *
 * Every other destination the engine writes a record to is a directory the
 * wipe deletes whole (`exports/` and `restores/` in the cache), so the
 * documents directory, where the platform record sits, is the one left to
 * sweep. A directory that cannot be listed holds none.
 */
export async function deleteRecordTemporaries(): Promise<void> {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return;
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(docDir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(RECORD_TEMP_PREFIX))
      .map((name) => FileSystem.deleteAsync(`${docDir}${name}`, { idempotent: true }))
  );
}
