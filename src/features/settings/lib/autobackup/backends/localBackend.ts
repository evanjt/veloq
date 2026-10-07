/**
 * Legacy reader for the app's old backup directory.
 *
 * Nothing writes there any more. Backups an older build made stay listed for
 * restore, and go only with a wipe.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { BackupBackend, BackupEntry } from './types';
import { safeGetTime } from '@/shared/format/format';
import { excludeFromBackup } from '@/shared/native/backupExclusion';

/** Resolve the backup directory at call time (not module load time). */
function getBackupDir(): string {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) throw new Error('Device storage not available');
  return `${docDir}backups/`;
}

/**
 * The share sheet's copy of a record zip, `veloq-backup-<date>.zip`. It is
 * written under the cache's exports directory, which the wipe deletes whole,
 * and older builds wrote it at the cache root, which is matched here.
 */
export const SHARE_COPY_PREFIX = 'veloq-backup-';

/**
 * The restore copies older builds wrote at the cache root, before restores had
 * a directory of their own in `cacheFiles.ts`. Matched so the wipe still finds
 * one a kill left behind.
 */
const RESTORE_COPY_PREFIX = 'restore-';

/** The whole-database snapshot an older auto-backup staged in the cache root before uploading. */
export const AUTOBACKUP_SNAPSHOT_PREFIX = 'veloq-autobackup-';

/**
 * Delete every backup file on the device: the local backups, the old
 * whole-database copies beside them, and the copies older builds left at the
 * cache root.
 *
 * A record zip names its athlete and carries their decisions, an old database
 * copy carries their whole library, and the login screen offers the newest
 * local backup to whoever opens an empty library.
 */
export async function deleteBackupFiles(): Promise<void> {
  const deletions: Promise<void>[] = [FileSystem.deleteAsync(getBackupDir(), { idempotent: true })];
  const cacheDir = FileSystem.cacheDirectory;
  if (cacheDir) {
    const info = await FileSystem.getInfoAsync(cacheDir);
    const names = info.exists ? await FileSystem.readDirectoryAsync(cacheDir) : [];
    for (const name of names) {
      if (
        name.startsWith(SHARE_COPY_PREFIX) ||
        name.startsWith(RESTORE_COPY_PREFIX) ||
        name.startsWith(AUTOBACKUP_SNAPSHOT_PREFIX)
      ) {
        deletions.push(FileSystem.deleteAsync(`${cacheDir}${name}`, { idempotent: true }));
      }
    }
  }
  await Promise.all(deletions);
}

/**
 * Keep the backup directory out of the device backup.
 *
 * The platform backup already carries the latest record zip from the documents
 * root, so the generations here are copies of it, and an older build left whole
 * database copies beside them. The attribute lives on the directory, so a wipe
 * that deletes it takes the attribute too, so launch asks every time.
 */
export function excludeLocalBackupsFromDeviceBackup(): void {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return;
  if (excludeFromBackup(`${docDir}backups/`) === false) {
    console.warn('[backup] local backups are not excluded from the device backup');
  }
}

export const localBackend: BackupBackend = {
  id: 'local',
  name: 'This device (older backups)',
  isRemote: false,

  async isAvailable(): Promise<boolean> {
    return true; // Always available
  },

  async listBackups(): Promise<BackupEntry[]> {
    const dir = getBackupDir();
    if (!(await FileSystem.getInfoAsync(dir)).exists) return [];
    const files = await FileSystem.readDirectoryAsync(dir);
    const entries: BackupEntry[] = [];

    for (const file of files) {
      if (!file.endsWith('.zip') && !file.endsWith('.veloqdb')) continue;

      const metaPath = `${dir}${file}.meta.json`;
      const metaInfo = await FileSystem.getInfoAsync(metaPath);
      if (!metaInfo.exists) continue;

      try {
        const metaJson = await FileSystem.readAsStringAsync(metaPath);
        const meta = JSON.parse(metaJson) as BackupEntry;
        entries.push(meta);
      } catch {
        // Skip entries with corrupt metadata
      }
    }

    // Sort newest first
    entries.sort((a, b) => safeGetTime(new Date(b.timestamp)) - safeGetTime(new Date(a.timestamp)));
    return entries;
  },

  async upload(): Promise<void> {
    throw new Error('The old backup directory is read-only');
  },

  async download(backupId: string, destPath: string): Promise<void> {
    const dir = getBackupDir();
    const sourcePath = `${dir}${backupId}`;
    const info = await FileSystem.getInfoAsync(sourcePath);
    if (!info.exists) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    await FileSystem.copyAsync({ from: sourcePath, to: destPath });
  },

  async delete(backupId: string): Promise<void> {
    const dir = getBackupDir();
    const filePath = `${dir}${backupId}`;
    await FileSystem.deleteAsync(filePath, { idempotent: true });
    await FileSystem.deleteAsync(`${filePath}.meta.json`, { idempotent: true });
  },
};
