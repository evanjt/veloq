/**
 * A folder the athlete picks on their own storage: an iOS Files folder, which
 * may sit in a cloud drive, or an Android storage-access folder.
 *
 * Each run adds one `veloq-<timestamp>.zip` and nothing here deletes one: the
 * folder is the athlete's, so what it keeps is theirs to manage. Which folder
 * is held, and how, is `shared/native/backupFolder.ts`. On Android the picker
 * takes a persistable grant on the tree and the files are reached through it
 * here. On iOS every call goes through the native module, which resolves the
 * bookmark and opens the folder for the length of the call.
 */

import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';

import { safeGetTime } from '@/shared/format/format';
import {
  forgetBackupFolder,
  heldBackupFolder,
  heldBackupFolderName,
  holdBackupFolder,
  isFolderUnavailableError,
  listBookmarkedFolder,
  readFromBookmarkedFolder,
  writeToBookmarkedFolder,
} from '@/shared/native/backupFolder';
import { BackupTransferError } from './errors';
import type { BackupBackend, BackupEntry } from './types';

export { forgetBackupFolder };

/** The codes each platform's picker rejects with when the athlete dismisses it. */
const PICKER_DISMISSED = new Set(['ERR_PICKER_CANCELLED', 'ERR_FILE_PICKING_CANCELLED']);

/** `veloq-2026-03-14T06-30-00-000Z.zip`: the run's instant with no character a file system refuses. */
const BACKUP_NAME = /^veloq-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.zip$/;

/** The name a run's zip takes in the folder, from the run's ISO timestamp. */
export function folderBackupName(timestamp: string): string {
  const at = new Date(timestamp);
  const iso = (Number.isNaN(at.getTime()) ? new Date() : at).toISOString();
  return `veloq-${iso.replace(/[:.]/g, '-')}.zip`;
}

/** The ISO instant a run's zip name carries, or null for any other file. */
function timestampOf(name: string): string | null {
  const m = BACKUP_NAME.exec(name);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}

function folderUnavailable(operation: string, cause: unknown): BackupTransferError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new BackupTransferError(
    operation,
    'folder_unavailable',
    `${operation} failed: the backup folder is out of reach (${detail})`
  );
}

/** Run an iOS bookmark call, reporting a folder out of reach as one. */
function onIos<T>(operation: string, call: () => T): T {
  try {
    return call();
  } catch (e) {
    throw isFolderUnavailableError(e) ? folderUnavailable(operation, e) : e;
  }
}

/**
 * The Android tree, once it has answered. A folder that was deleted, sits on
 * storage that was removed, or whose grant was revoked either reads as missing
 * or throws, and both need the athlete to choose it again.
 */
function reachableTree(operation: string): Directory {
  const uri = heldBackupFolder();
  if (!uri) throw new Error('No backup folder chosen');
  const dir = new Directory(uri);
  let exists: boolean;
  try {
    exists = dir.exists;
  } catch (e) {
    throw folderUnavailable(operation, e);
  }
  if (!exists) throw folderUnavailable(operation, 'it no longer exists');
  return dir;
}

/** The Android tree's regular files. */
function treeFiles(operation: string): File[] {
  const dir = reachableTree(operation);
  let children: (Directory | File)[];
  try {
    children = dir.list();
  } catch (e) {
    throw folderUnavailable(operation, e);
  }
  return children.filter((child): child is File => child instanceof File);
}

/**
 * Open the platform's folder picker and hold the folder chosen. Returns its
 * display name, or null when the athlete dismissed the picker, in which case
 * the folder held before stays as it was.
 */
export async function pickBackupFolder(): Promise<string | null> {
  let picked: Directory;
  try {
    picked = await Directory.pickDirectoryAsync();
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && PICKER_DISMISSED.has(code)) return null;
    throw e;
  }
  holdBackupFolder(picked.uri, picked.name);
  return picked.name;
}

/** The held folder's display name, or null when none is held. */
export function getBackupFolderName(): string | null {
  return heldBackupFolderName();
}

export const folderBackend: BackupBackend = {
  id: 'folder',
  name: 'Folder',
  isRemote: false,

  // Held, not resolved: a folder that has gone out of reach is a failure the
  // athlete is shown, not a carrier that quietly stops being tried.
  async isAvailable(): Promise<boolean> {
    return heldBackupFolder() !== null;
  },

  async listBackups(): Promise<BackupEntry[]> {
    const operation = 'List backups';
    const files =
      Platform.OS === 'ios'
        ? onIos(operation, listBookmarkedFolder)
        : treeFiles(operation).map((file) => ({ name: file.name, size: file.size ?? 0 }));
    const entries: BackupEntry[] = [];
    for (const { name, size } of files) {
      const timestamp = timestampOf(name);
      if (timestamp) entries.push({ id: name, timestamp, sizeBytes: size, appVersion: '' });
    }
    entries.sort((a, b) => safeGetTime(new Date(b.timestamp)) - safeGetTime(new Date(a.timestamp)));
    return entries;
  },

  async upload(localPath: string, metadata: Omit<BackupEntry, 'id'>): Promise<void> {
    const operation = 'Copy backup';
    const name = folderBackupName(metadata.timestamp);
    if (Platform.OS === 'ios') {
      onIos(operation, () => writeToBookmarkedFolder(localPath, name));
      return;
    }
    const dir = reachableTree(operation);
    // Read first, so a zip that cannot be read leaves no empty file behind.
    const bytes = await new File(localPath).bytes();
    const target = dir.createFile(name, 'application/zip');
    try {
      target.write(bytes);
    } catch (e) {
      // The file is this run's own and holds a partial zip, so it goes.
      try {
        target.delete();
      } catch {
        // A folder that refused the write may refuse the delete as well.
      }
      throw e;
    }
  },

  async download(backupId: string, destPath: string): Promise<void> {
    const operation = 'Restore backup';
    if (Platform.OS === 'ios') {
      onIos(operation, () => readFromBookmarkedFolder(backupId, destPath));
      return;
    }
    const source = treeFiles(operation).find((file) => file.name === backupId);
    if (!source) throw new Error(`Backup not found: ${backupId}`);
    await source.copy(new File(destPath), { overwrite: true });
  },

  async delete(): Promise<void> {
    throw new Error('Veloq deletes nothing in a backup folder the athlete chose');
  },
};
