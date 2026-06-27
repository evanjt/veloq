/**
 * iCloud Documents backup backend (iOS only).
 *
 * Uses react-native-cloud-storage for iCloud Document container access.
 * Lazy-loaded to avoid crashes on Android where the native module isn't available.
 *
 * Prerequisites:
 * - npm install react-native-cloud-storage
 * - with-icloud.js Expo config plugin registered in app.json
 * - iCloud capability enabled in Xcode
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { BackupBackend, BackupEntry } from './types';

const REMOTE_DIR = '/Veloq';

/** Lazy-load the cloud storage module (iOS only). */
async function getCloudStorage() {
  if (Platform.OS !== 'ios') return null;
  try {
    const mod = await import('react-native-cloud-storage');
    return mod.CloudStorage;
  } catch {
    return null;
  }
}

export const icloudBackend: BackupBackend = {
  id: 'icloud',
  name: 'iCloud',

  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;
    try {
      const cs = await getCloudStorage();
      if (!cs) return false;
      return await cs.isCloudAvailable();
    } catch {
      return false;
    }
  },

  async listBackups(): Promise<BackupEntry[]> {
    const cs = await getCloudStorage();
    if (!cs) return [];

    try {
      // Ensure directory exists
      const dirExists = await cs.exists(`${REMOTE_DIR}`);
      if (!dirExists) return [];

      const files = await cs.readdir(REMOTE_DIR);
      const metaFiles = files.filter((f: string) => f.endsWith('.meta.json'));
      const entries: BackupEntry[] = [];

      for (const metaFile of metaFiles) {
        try {
          const content = await cs.readFile(`${REMOTE_DIR}/${metaFile}`);
          const meta = JSON.parse(content) as BackupEntry;
          entries.push(meta);
        } catch {
          // Skip corrupt metadata
        }
      }

      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return entries;
    } catch {
      return [];
    }
  },

  async upload(localPath: string, metadata: Omit<BackupEntry, 'id'>): Promise<void> {
    const cs = await getCloudStorage();
    if (!cs) throw new Error('iCloud not available');

    // Ensure directory
    const dirExists = await cs.exists(REMOTE_DIR);
    if (!dirExists) {
      await cs.mkdir(REMOTE_DIR);
    }

    const filename = `veloq-${metadata.timestamp.replace(/[:.]/g, '-')}.veloqdb`;
    const remotePath = `${REMOTE_DIR}/${filename}`;

    // Read local file and write to iCloud
    const data = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await cs.writeFile(remotePath, data);

    // Write metadata sidecar
    const entry: BackupEntry = { ...metadata, id: filename };
    await cs.writeFile(`${remotePath}.meta.json`, JSON.stringify(entry, null, 2));
  },

  async download(backupId: string, destPath: string): Promise<void> {
    const cs = await getCloudStorage();
    if (!cs) throw new Error('iCloud not available');

    const remotePath = `${REMOTE_DIR}/${backupId}`;
    const data = await cs.readFile(remotePath);

    await FileSystem.writeAsStringAsync(destPath, data, {
      encoding: FileSystem.EncodingType.Base64,
    });
  },

  async delete(backupId: string): Promise<void> {
    const cs = await getCloudStorage();
    if (!cs) return;

    try {
      await cs.unlink(`${REMOTE_DIR}/${backupId}`);
      await cs.unlink(`${REMOTE_DIR}/${backupId}.meta.json`);
    } catch {
      // Best effort
    }
  },
};
