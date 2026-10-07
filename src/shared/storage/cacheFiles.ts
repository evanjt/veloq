/**
 * The directories in the cache that hold the athlete's own files.
 *
 * A file handed to the share sheet, a route picture for a notification, the
 * document picker's copy of a file chosen for import and a restore's copy of a
 * backup each sit in a directory of their own, so the wipe deletes the
 * directory rather than a list of names and a new copy cannot slip past it.
 */

import * as FileSystem from 'expo-file-system/legacy';

/** Every file the app writes for the share sheet: backups, activity exports, GPX, crash logs. */
export const EXPORTS_DIR = 'exports/';

/** The route line an enriched notification carries. */
export const ROUTE_LINE_DIR = 'notification_routes/';

/** Where the document picker copies a file chosen for import, on both platforms. */
const PICKER_DIR = 'DocumentPicker/';

/** The copies a restore takes of a backup before reading it. */
export const RESTORES_DIR = 'restores/';

/**
 * Names older builds wrote straight into the cache root, before exports had a
 * directory: the activity exports, GPX files under the activity's name, and
 * the crash log.
 */
function isLegacyExport(name: string): boolean {
  return (
    name.startsWith('veloq-activities-') || name.endsWith('.gpx') || name === 'veloq-crash-log.txt'
  );
}

function cacheRoot(): string {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error('Device storage not available');
  return cacheDir;
}

/** The uri to write a file for the share sheet to, with its directory made. */
export async function exportFileUri(filename: string): Promise<string> {
  const dir = `${cacheRoot()}${EXPORTS_DIR}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return `${dir}${filename}`;
}

/**
 * The uri a restore copies a backup to before reading it, with its directory
 * made. Each copy is deleted when its restore settles, so only a kill part way
 * leaves one, and the wipe deletes the directory whole.
 */
export async function restoreCopyUri(filename: string): Promise<string> {
  const dir = `${cacheRoot()}${RESTORES_DIR}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return `${dir}${filename}`;
}

/** Whether `uri` is the document picker's own copy, and so the app's to delete. */
export function isPickerCopy(uri: string): boolean {
  const cacheDir = FileSystem.cacheDirectory;
  return !!cacheDir && uri.startsWith(`${cacheDir}${PICKER_DIR}`);
}

/**
 * Delete every athlete file in the cache: the share sheet's copies, the route
 * pictures, the picker's import copies and the restore copies, and the exports
 * older builds left at the cache root.
 */
export async function deleteCachedAthleteFiles(): Promise<void> {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) return;
  const deletions = [EXPORTS_DIR, ROUTE_LINE_DIR, PICKER_DIR, RESTORES_DIR].map((dir) =>
    FileSystem.deleteAsync(`${cacheDir}${dir}`, { idempotent: true })
  );
  const info = await FileSystem.getInfoAsync(cacheDir);
  const names = info.exists ? await FileSystem.readDirectoryAsync(cacheDir) : [];
  for (const name of names) {
    if (isLegacyExport(name)) {
      deletions.push(FileSystem.deleteAsync(`${cacheDir}${name}`, { idempotent: true }));
    }
  }
  await Promise.all(deletions);
}
