/**
 * iCloud Documents backup backend (iOS only).
 *
 * Uses react-native-cloud-storage for iCloud Document container access.
 * Lazy-loaded to avoid crashes on Android where the native module isn't available.
 *
 * Prerequisites:
 * - The react-native-cloud-storage Expo config plugin registered in app.json
 * - An iCloud.com.veloq.app container provisioned for the bundle identifier
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { BackupBackend, BackupEntry } from './types';
import { BackupTransferError, cloudFailure } from './errors';
import { debug } from '@/shared/debug/debug';

const log = debug.create('IcloudBackend');

const REMOTE_DIR = '/Veloq';
const DB_MIME_TYPE = 'application/octet-stream';

let scopeConfigured = false;

/** Lazy-load the cloud storage module (iOS only), pinned to the Documents scope. */
async function getCloudStorage() {
  if (Platform.OS !== 'ios') return null;
  try {
    const mod = await import('react-native-cloud-storage');
    const scope = mod.CloudStorageScope.Documents;
    if (!scopeConfigured) {
      // The provider defaults to app_data, which hides backups from the Files
      // app. A backup is worth having precisely when the app is not.
      mod.CloudStorage.setProviderOptions({ scope });
      scopeConfigured = true;
    }
    return { cs: mod.CloudStorage, scope };
  } catch {
    return null;
  }
}

/** Native file APIs take a filesystem path, not the file:// URI expo hands out. */
function plainPath(path: string): string {
  return path.startsWith('file://') ? path.slice('file://'.length) : path;
}

async function attempt<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw cloudFailure(operation, error);
  }
}

/** Retention is best effort, but a delete that always fails deserves a signal. */
async function unlinkQuietly(
  cs: { unlink: (path: string) => Promise<void> },
  path: string
): Promise<void> {
  try {
    await cs.unlink(path);
  } catch (error) {
    log.warn('Delete failed:', error instanceof Error ? error.message : String(error));
  }
}

export const icloudBackend: BackupBackend = {
  id: 'icloud',
  name: 'iCloud',

  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;
    try {
      const api = await getCloudStorage();
      if (!api) return false;
      return await api.cs.isCloudAvailable();
    } catch {
      return false;
    }
  },

  async listBackups(): Promise<BackupEntry[]> {
    const api = await getCloudStorage();
    if (!api) return [];
    const { cs } = api;

    const dirExists = await attempt('List backups', () => cs.exists(REMOTE_DIR));
    if (!dirExists) return [];

    const files = await attempt('List backups', () => cs.readdir(REMOTE_DIR));
    const metaFiles = files.filter((f: string) => f.endsWith('.meta.json'));
    const entries: BackupEntry[] = [];

    for (const metaFile of metaFiles) {
      const metaPath = `${REMOTE_DIR}/${metaFile}`;
      try {
        // A listed file is not necessarily materialised on this device
        await cs.triggerSync(metaPath);
        const content = await cs.readFile(metaPath);
        entries.push(JSON.parse(content) as BackupEntry);
      } catch {
        // Skip corrupt or unreachable metadata
      }
    }

    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return entries;
  },

  async upload(localPath: string, metadata: Omit<BackupEntry, 'id'>): Promise<void> {
    const api = await getCloudStorage();
    if (!api) throw new Error('iCloud not available');
    const { cs } = api;

    const dirExists = await attempt('Upload backup', () => cs.exists(REMOTE_DIR));
    if (!dirExists) {
      await attempt('Upload backup', () => cs.mkdir(REMOTE_DIR));
    }

    const filename = `veloq-${metadata.timestamp.replace(/[:.]/g, '-')}.veloqdb`;
    const remotePath = `${REMOTE_DIR}/${filename}`;

    // Native transfer keeps a multi-megabyte snapshot out of the JS heap
    await attempt('Upload backup', () =>
      cs.uploadFile(remotePath, plainPath(localPath), { mimeType: DB_MIME_TYPE })
    );

    // An iCloud write can be queued rather than committed, so a resolved
    // promise is not proof that anything landed.
    const written = await attempt('Upload backup', () => cs.exists(remotePath));
    if (!written) {
      throw new BackupTransferError(
        'Upload backup',
        'server',
        'iCloud did not commit the backup file'
      );
    }

    // The sidecar is small enough for a string, and listBackups needs it
    const entry: BackupEntry = { ...metadata, id: filename };
    await attempt('Upload backup metadata', () =>
      cs.writeFile(`${remotePath}.meta.json`, JSON.stringify(entry, null, 2))
    );
  },

  async download(backupId: string, destPath: string): Promise<void> {
    const api = await getCloudStorage();
    if (!api) throw new Error('iCloud not available');
    const { cs, scope } = api;

    const remotePath = `${REMOTE_DIR}/${backupId}`;
    // The file may only exist in the cloud, which is the whole point of
    // restoring onto a second device
    await attempt('Download backup', () => cs.triggerSync(remotePath));

    // downloadFile refuses to overwrite, so clear a temp file a failed
    // restore left behind
    await FileSystem.deleteAsync(destPath, { idempotent: true });

    // The scope argument is not optional in practice: the static overload
    // dispatches a two-argument call to triggerSync instead of downloading.
    await attempt('Download backup', () => cs.downloadFile(remotePath, plainPath(destPath), scope));
  },

  async delete(backupId: string): Promise<void> {
    const api = await getCloudStorage();
    if (!api) return;
    const { cs } = api;

    await unlinkQuietly(cs, `${REMOTE_DIR}/${backupId}`);
    await unlinkQuietly(cs, `${REMOTE_DIR}/${backupId}.meta.json`);
  },
};
