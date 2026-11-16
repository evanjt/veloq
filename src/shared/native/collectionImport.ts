/** The engine's collection import calls, behind the shared engine layer. */

import { sync, type FfiImportProgress } from 'veloqrs';

/** The engine reads a filesystem path, so a `file://` uri is turned into one. */
export function enginePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

/** Start an import of the file, directory or zip at `uri`. False when one cannot start now. */
export const startCollectionImport = (uri: string): boolean => sync.startImport(enginePath(uri));

/** Stop the running import at its next file. */
export const cancelCollectionImport = (): void => sync.cancelImport();

/** The import's state, counts and first failures. */
export const readImportProgress = (): FfiImportProgress => sync.importProgress();
