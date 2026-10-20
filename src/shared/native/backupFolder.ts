import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { debug } from '@/shared/debug/debug';
import { getEngine } from '@/shared/native/engine';

const log = debug.create('BackupFolder');

/**
 * The backup folder the athlete picked: an Android tree URI, or an iOS bookmark
 * in base64. A grant on one phone means nothing on another, so it is held under
 * the `__` prefix, which keeps it out of the record zip.
 */
const SETTING_FOLDER = '__backup_folder';
const SETTING_FOLDER_NAME = '__backup_folder_name';
/**
 * Set to '1' while the athlete has stopped the device copy on Android; absent,
 * a run with no folder picked writes to the shared `Documents/Veloq`.
 */
const SETTING_FOLDER_OFF = '__backup_folder_off';

/**
 * Where an Android run with no folder picked writes, through the media store:
 * a public folder that shows in the Files app and outlives an uninstall.
 */
export const SHARED_BACKUP_FOLDER = 'Documents/Veloq';

/** The code the native side throws when a bookmark no longer resolves to a folder it can open. */
const FOLDER_UNAVAILABLE_CODE = 'ERR_FOLDER_UNAVAILABLE';

/** A call made through the bookmark, and the bookmark to keep when it was refreshed. */
interface BookmarkedResult {
  bookmark?: string | null;
}

interface VeloqBackupFolderModule {
  bookmarkFolder(uri: string): string;
  writeToBookmarkedFolder(bookmark: string, from: string, name: string): Promise<BookmarkedResult>;
  listBookmarkedFolder(
    bookmark: string
  ): Promise<BookmarkedResult & { files: { name: string; size: number }[] }>;
  readFromBookmarkedFolder(bookmark: string, name: string, to: string): Promise<BookmarkedResult>;
  releaseFolderGrant(uri: string): void;
  sharedDocumentsSupported?(): boolean;
  writeSharedDocument(from: string, name: string, mimeType: string): Promise<string>;
  listSharedDocuments(): Promise<{ name: string; size: number }[]>;
  readSharedDocument(name: string, to: string): Promise<void>;
  saveDocument(
    from: string,
    name: string,
    mimeType: string,
    initialTree: string | null
  ): Promise<boolean>;
}

function nativeModule(): VeloqBackupFolderModule {
  const mod = requireOptionalNativeModule<VeloqBackupFolderModule>('VeloqBackupExclusion');
  if (!mod) throw new Error('The backup folder module is not in this build');
  return mod;
}

function plainPath(path: string): string {
  return path.startsWith('file://') ? path.slice(7) : path;
}

/** Whether the native side refused because the folder is gone or out of reach. */
export function isFolderUnavailableError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === FOLDER_UNAVAILABLE_CODE;
}

/** The held folder's reference, or null when none is held. */
export function heldBackupFolder(): string | null {
  return getEngine()?.getSetting(SETTING_FOLDER) || null;
}

/**
 * Whether the device copy may go to the shared `Documents/Veloq`: on Android
 * 10 and later, until the athlete stops it. Below Android 10 the media store
 * takes no relative path without a storage permission, so there the folder is
 * only ever one the athlete picks.
 */
export function canWriteSharedFolder(): boolean {
  if (Platform.OS !== 'android') return false;
  if (getEngine()?.getSetting(SETTING_FOLDER_OFF) === '1') return false;
  try {
    return (
      requireOptionalNativeModule<VeloqBackupFolderModule>(
        'VeloqBackupExclusion'
      )?.sharedDocumentsSupported?.() === true
    );
  } catch {
    return false;
  }
}

/** Whether a run writes to the shared `Documents/Veloq`, which it does while no folder is picked. */
export function isSharedBackupFolder(): boolean {
  return heldBackupFolder() === null && canWriteSharedFolder();
}

/**
 * What a run writes to: the held folder's reference, the shared folder's path,
 * or null when there is neither.
 */
export function backupFolderTarget(): string | null {
  return heldBackupFolder() ?? (isSharedBackupFolder() ? SHARED_BACKUP_FOLDER : null);
}

/** The display name of the folder a run writes to, or null when there is none. */
export function heldBackupFolderName(): string | null {
  if (!heldBackupFolder()) return isSharedBackupFolder() ? SHARED_BACKUP_FOLDER : null;
  return getEngine()?.getSetting(SETTING_FOLDER_NAME) || null;
}

/**
 * Hold a picked folder. On iOS `uri` is the picker's URL and a bookmark of it is
 * made now, while the picker's grant is held: that grant ends with the process,
 * so a run on a later launch reaches the folder only through the bookmark. A
 * folder held before gives back its Android grant.
 */
export function holdBackupFolder(uri: string, name: string): void {
  const reference = Platform.OS === 'ios' ? nativeModule().bookmarkFolder(uri) : uri;
  const previous = heldBackupFolder();
  const engine = getEngine();
  engine?.setSetting(SETTING_FOLDER, reference);
  engine?.setSetting(SETTING_FOLDER_NAME, name);
  engine?.deleteSetting(SETTING_FOLDER_OFF);
  if (previous && previous !== reference) releaseFolderGrant(previous);
}

/**
 * Let go of the held folder: its reference, its name and, on Android, the
 * grant. A stopped device copy is on again, so the next athlete starts from
 * the shared folder.
 */
export function forgetBackupFolder(): void {
  const folder = heldBackupFolder();
  const engine = getEngine();
  engine?.deleteSetting(SETTING_FOLDER);
  engine?.deleteSetting(SETTING_FOLDER_NAME);
  engine?.deleteSetting(SETTING_FOLDER_OFF);
  if (folder) releaseFolderGrant(folder);
}

/**
 * Stop the device copy on Android: let go of a picked folder and write nothing
 * to the shared one either. The zips already written stay, as they are the
 * athlete's. Picking a folder turns the copy on again.
 */
export function stopBackupFolder(): void {
  forgetBackupFolder();
  getEngine()?.setSetting(SETTING_FOLDER_OFF, '1');
}

/** Copy a file into the shared `Documents/Veloq`, answering the name it was given. */
export async function writeToSharedFolder(
  from: string,
  name: string,
  mimeType: string
): Promise<string> {
  return await nativeModule().writeSharedDocument(plainPath(from), name, mimeType);
}

/**
 * The files this install wrote to the shared `Documents/Veloq`, by name and
 * size. The media store lists only an install's own files, so after a
 * reinstall the earlier zips are there but not listed.
 */
export async function listSharedFolder(): Promise<{ name: string; size: number }[]> {
  return await nativeModule().listSharedDocuments();
}

/** Copy the file `name` out of the shared `Documents/Veloq` to `to`. */
export async function readFromSharedFolder(name: string, to: string): Promise<void> {
  await nativeModule().readSharedDocument(name, plainPath(to));
}

/**
 * Run a native call through the held iOS bookmark, keeping the bookmark it
 * refreshed. The call runs off the JavaScript thread, since a folder in a cloud
 * drive holds it until the files download.
 */
async function throughBookmark<T extends BookmarkedResult>(
  call: (bookmark: string) => Promise<T>
): Promise<T> {
  const bookmark = heldBackupFolder();
  if (!bookmark) throw new Error('No backup folder chosen');
  const result = await call(bookmark);
  if (result.bookmark && result.bookmark !== bookmark) {
    getEngine()?.setSetting(SETTING_FOLDER, result.bookmark);
  }
  return result;
}

/** Copy a file into the held iOS folder under `name`. */
export async function writeToBookmarkedFolder(from: string, name: string): Promise<void> {
  await throughBookmark(
    async (bookmark) =>
      await nativeModule().writeToBookmarkedFolder(bookmark, plainPath(from), name)
  );
}

/** The held iOS folder's regular files, by name and size. */
export async function listBookmarkedFolder(): Promise<{ name: string; size: number }[]> {
  const result = await throughBookmark(
    async (bookmark) => await nativeModule().listBookmarkedFolder(bookmark)
  );
  return result.files;
}

/** Copy the file `name` out of the held iOS folder to `to`. */
export async function readFromBookmarkedFolder(name: string, to: string): Promise<void> {
  await throughBookmark(
    async (bookmark) => await nativeModule().readFromBookmarkedFolder(bookmark, name, plainPath(to))
  );
}

/**
 * Save a file to a place the athlete picks on Android's create-document screen,
 * suggesting `name` and starting in the held backup folder when there is one.
 * Answers false when the screen was backed out of.
 */
export async function saveToDevice(from: string, name: string, mimeType: string): Promise<boolean> {
  return await nativeModule().saveDocument(plainPath(from), name, mimeType, heldBackupFolder());
}

/**
 * Give back the persisted storage-access grant on an Android folder, so the
 * folder leaves the grants the system holds for the app. Nothing to do on iOS,
 * where the bookmark is the whole grant and deleting it is enough.
 */
function releaseFolderGrant(uri: string): void {
  if (Platform.OS !== 'android') return;
  try {
    requireOptionalNativeModule<VeloqBackupFolderModule>(
      'VeloqBackupExclusion'
    )?.releaseFolderGrant(uri);
  } catch (e) {
    log.warn('could not release the grant on', uri, e);
  }
}
