/**
 * Where a recording's files sit, the one place that says so.
 *
 * On iOS an update can move the app's data container and keep its files, so an
 * absolute path stored by one launch can name a directory the next one does
 * not have. A recording row stores each file's name relative to the documents
 * directory and is resolved against the live one on every read; the engine
 * gets the live directory with every call that can start an upload and
 * resolves its rows the same way (`recording_file` in `upload_recording.rs`).
 */

import * as FileSystem from 'expo-file-system/legacy';

/** The documents directory as this launch sees it, with its trailing slash. */
export const DOCUMENTS_ROOT = FileSystem.documentDirectory ?? '';

const RECORDINGS_SUBDIR = 'recordings/';

/** Where a recording's FIT and a manual entry's body are written. */
export const RECORDINGS_DIR = `${DOCUMENTS_ROOT}${RECORDINGS_SUBDIR}`;

/** Where the old upload queue kept a FIT waiting to be sent. */
export const LEGACY_UPLOADS_DIR = `${DOCUMENTS_ROOT}pending_uploads/`;

/** A file under the documents directory, by its name relative to it. */
export function documentFile(name: string): string {
  return `${DOCUMENTS_ROOT}${name}`;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || path.startsWith('file://');
}

/** Whether `path` names a file directly inside a directory called `dir`. */
function sitsIn(path: string, dir: string): boolean {
  return path.slice(0, path.lastIndexOf('/') + 1).endsWith(`/${dir}`);
}

/**
 * The live path of a file a recording row names. A relative name resolves
 * against the documents directory. An absolute path under a `recordings/`
 * directory was stored by an earlier build and may name a container that has
 * since moved, so it resolves by its file name under the live one. Any other
 * absolute path is taken as it is, and the empty string a manual entry's FIT
 * path holds stays empty.
 */
export function recordingFilePath(stored: string): string {
  if (!stored) return stored;
  if (!isAbsolute(stored)) return documentFile(stored);
  if (stored.startsWith(DOCUMENTS_ROOT) || !sitsIn(stored, RECORDINGS_SUBDIR)) return stored;
  return `${RECORDINGS_DIR}${baseName(stored)}`;
}

/**
 * What a recording row stores for a file: its name relative to the documents
 * directory, so the row outlives a move of the container. A path outside
 * every `recordings/` directory is kept as it is.
 */
export function storedRecordingName(path: string): string {
  if (!path || !isAbsolute(path)) return path;
  const live = recordingFilePath(path);
  return DOCUMENTS_ROOT && live.startsWith(DOCUMENTS_ROOT)
    ? live.slice(DOCUMENTS_ROOT.length)
    : path;
}

/**
 * The live path of a FIT the old upload queue held, which it stored absolute.
 * Every one sat in `pending_uploads/`, so it is found there by its file name.
 */
export function legacyUploadPath(stored: string): string {
  return `${LEGACY_UPLOADS_DIR}${baseName(stored)}`;
}
