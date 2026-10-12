/**
 * Veloq's own folder in the athlete's iCloud Drive, on iPhone.
 *
 * The container is `iCloud.com.veloq.app`, reached through the Documents
 * scope so the backups show in the Files app under Veloq: a backup is worth
 * having precisely when the app is not, and a delete and reinstall finds them
 * again. Each run adds one `veloq-<timestamp>.zip` under `/Veloq`, named as the
 * folder carrier names them, and nothing here deletes one: what the folder
 * keeps is the athlete's to manage.
 *
 * It is on with nothing to set up. The athlete can turn it off; that switch is
 * held with the rest of the backup settings in `autoBackup.ts`, and forgetting
 * the carriers turns it back on and leaves every file in iCloud.
 *
 * The module is loaded only on iOS, since Android has no native half for it.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { safeGetTime } from '@/shared/format/format';
import { backupFileName, backupNameTimestamp } from './backupName';
import { BackupTransferError } from './errors';
import type { BackupBackend, BackupEntry } from './types';

/** The container the config plugin entitles the app to. */
export const ICLOUD_CONTAINER = 'iCloud.com.veloq.app';

const REMOTE_DIR = '/Veloq';
const ZIP_MIME_TYPE = 'application/zip';

/**
 * How long a listing waits for iCloud to answer. Straight after a launch, and
 * on a fresh install above all, the account can read as absent for a moment
 * before the container is ready.
 */
const CLOUD_WAIT_MS = 2000;
const CLOUD_POLL_MS = 250;

type CloudStorageModule = typeof import('react-native-cloud-storage');

let scopeConfigured = false;

/** The cloud storage module pinned to the Documents scope, or null off iOS. */
function cloudStorage(): {
  cs: CloudStorageModule['CloudStorage'];
  scope: CloudStorageModule['CloudStorageScope']['Documents'];
} | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const mod = require('react-native-cloud-storage') as CloudStorageModule;
    const scope = mod.CloudStorageScope.Documents;
    if (!scopeConfigured) {
      // The provider defaults to app_data, which hides backups from the Files app.
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

function remotePath(name: string): string {
  return `${REMOTE_DIR}/${name}`;
}

/**
 * A failure inside the container. The write is to the phone's own copy of
 * the container and iCloud uploads it later, so a refusal here is the phone's
 * and passes on its own: the next trigger sends the copy again.
 */
function cloudFailure(operation: string, cause: unknown): BackupTransferError {
  if (cause instanceof BackupTransferError) return cause;
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new BackupTransferError(operation, 'server', `${operation} failed: ${detail}`);
}

async function attempt<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw cloudFailure(operation, error);
  }
}

/** Whether this iPhone has an iCloud account Veloq can write to now. */
export async function isIcloudReachable(): Promise<boolean> {
  const api = cloudStorage();
  if (!api) return false;
  try {
    return await api.cs.isCloudAvailable();
  } catch {
    return false;
  }
}

/** Whether iCloud answers within the wait a listing allows. */
async function waitForCloud(): Promise<boolean> {
  const deadline = Date.now() + CLOUD_WAIT_MS;
  for (;;) {
    if (await isIcloudReachable()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, CLOUD_POLL_MS));
  }
}

/** Whether a restore can offer iCloud on this device at all. */
export function isIcloudSupported(): boolean {
  return Platform.OS === 'ios';
}

export const icloudBackend: BackupBackend = {
  id: 'icloud',
  name: 'iCloud Drive',
  // The write lands in the phone's copy of the container, and iCloud uploads
  // it when it can, so a run needs no radio for it.
  isRemote: false,

  // Whether the athlete left it on is the run's to ask, beside this.
  async isAvailable(): Promise<boolean> {
    return isIcloudReachable();
  },

  /**
   * The zips in `/Veloq`, newest first, whether or not each is on the phone
   * yet. Listed whatever the switch says, so a restore after a reinstall finds
   * them. Off iOS there is nothing to list.
   */
  async listBackups(): Promise<BackupEntry[]> {
    const api = cloudStorage();
    if (!api) return [];
    const { cs } = api;
    const operation = 'List backups';
    if (!(await waitForCloud())) {
      throw new BackupTransferError(
        operation,
        'icloud_unavailable',
        `${operation} failed: iCloud is not available on this iPhone`
      );
    }
    if (!(await attempt(operation, () => cs.exists(REMOTE_DIR)))) return [];
    const names = await attempt(operation, () => cs.readdir(REMOTE_DIR));
    const entries: BackupEntry[] = [];
    for (const name of names) {
      const timestamp = backupNameTimestamp(name);
      if (!timestamp) continue;
      let sizeBytes = 0;
      try {
        sizeBytes = (await cs.stat(remotePath(name))).size;
      } catch {
        // The size is only a label, so a file iCloud has not described yet still lists.
      }
      entries.push({ id: name, timestamp, sizeBytes, appVersion: '' });
    }
    entries.sort((a, b) => safeGetTime(new Date(b.timestamp)) - safeGetTime(new Date(a.timestamp)));
    return entries;
  },

  async upload(localPath: string, metadata: Omit<BackupEntry, 'id'>): Promise<string> {
    const api = cloudStorage();
    if (!api) throw new Error('iCloud is not available on this device');
    const { cs } = api;
    const operation = 'Upload backup';
    const name = backupFileName(metadata.timestamp);
    if (!(await attempt(operation, () => cs.exists(REMOTE_DIR)))) {
      await attempt(operation, () => cs.mkdir(REMOTE_DIR));
    }
    // A native copy keeps the zip out of the JS heap.
    await attempt(operation, () =>
      cs.uploadFile(remotePath(name), plainPath(localPath), { mimeType: ZIP_MIME_TYPE })
    );
    return name;
  },

  /**
   * Copy a backup out of the container. After a reinstall a file is listed
   * before it is on the phone, so it is fetched first.
   */
  async download(backupId: string, destPath: string): Promise<void> {
    const api = cloudStorage();
    if (!api) throw new Error('iCloud is not available on this device');
    const { cs, scope } = api;
    const operation = 'Download backup';
    const from = remotePath(backupId);
    await attempt(operation, () => cs.triggerSync(from));
    // The copy refuses to overwrite, so clear what a failed restore left behind.
    await FileSystem.deleteAsync(destPath, { idempotent: true });
    // The scope is passed so the call copies the file rather than only fetching it.
    await attempt(operation, () => cs.downloadFile(from, plainPath(destPath), scope));
  },

  async delete(): Promise<void> {
    throw new Error("Veloq deletes nothing in the athlete's iCloud Drive");
  },
};
