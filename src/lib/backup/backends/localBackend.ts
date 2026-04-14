/**
 * Local file backup backend.
 *
 * Export: Creates a SQLite snapshot and shares via OS share sheet.
 * Import: Picks a file via document picker.
 * List: Scans the app's backup directory for .veloqdb files.
 *
 * This is the default backend that works on both platforms with no
 * external account or registration.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { BackupBackend, BackupEntry } from './types';
import { safeGetTime } from '@/lib/utils/format';

/** Resolve the backup directory at call time (not module load time). */
function getBackupDir(): string {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) throw new Error('Device storage not available');
  return `${docDir}backups/`;
}

async function ensureBackupDir(): Promise<string> {
  const dir = getBackupDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

export const localBackend: BackupBackend = {
  id: 'local',
  name: 'Local Storage',

  async isAvailable(): Promise<boolean> {
    return true; // Always available
  },

  async listBackups(): Promise<BackupEntry[]> {
    const dir = await ensureBackupDir();
    const files = await FileSystem.readDirectoryAsync(dir);
    const entries: BackupEntry[] = [];

    for (const file of files) {
      if (!file.endsWith('.veloqdb')) continue;

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

  async upload(localPath: string, metadata: Omit<BackupEntry, 'id'>): Promise<void> {
    const dir = await ensureBackupDir();

    const filename = `veloq-${metadata.timestamp.replace(/[:.]/g, '-')}.veloqdb`;
    const destPath = `${dir}${filename}`;

    // Copy the backup file
    await FileSystem.copyAsync({ from: localPath, to: destPath });

    // Write metadata alongside
    const entry: BackupEntry = { ...metadata, id: filename };
    await FileSystem.writeAsStringAsync(`${destPath}.meta.json`, JSON.stringify(entry, null, 2));
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
