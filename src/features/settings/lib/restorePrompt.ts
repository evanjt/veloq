/**
 * The one-time offer to restore on an empty signed-in library.
 *
 * The platform record zip restores itself. A library with no zip to apply, or
 * one the engine refused, is otherwise left empty with no word that a backup in
 * a file or on a WebDAV server exists. The offer is a card on the feed, never a
 * modal over the tour, and it is answered once, by sharing the platform
 * record's marker: a restore or a dismissal both mean the athlete has been
 * asked.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { platformRecordUri } from '@/shared/storage/platformRecord';
import { isPlatformRecordAnswered, markPlatformRecordAnswered } from './autobackup/autoBackup';
import {
  googleDriveBackend,
  icloudBackend,
  isIcloudSupported,
  webdavBackend,
  type BackupBackend,
  type BackupEntry,
} from './autobackup/backends';
import { checkRecordBackup, restoreRecordBackup } from './backup';
import { restoreBackendEntry } from './restoreBackendEntry';
import type { RestoreOutcome } from './restoreNotice';
import { getWebdavConfig, initWebdavConfig } from './autobackup/webdavConfig';
import { useWhatsNewStore } from '../stores/WhatsNewStore';

/** Where a found backup sits. `device` is the device backup's record zip. */
export type BackupSource = 'device' | 'webdav' | 'googleDrive' | 'icloud';

/**
 * The backup the offer names and restores. `backend` fetches it, and is null
 * for the record zip, which is already on the phone.
 */
export interface FoundBackup {
  source: BackupSource;
  entry: BackupEntry;
  backend: BackupBackend | null;
}

/**
 * Whether to offer a restore. `activityCount` is read before the launch sync.
 * A first launch with no backup found offers nothing: restoring from a file or
 * a server stays in Settings, Backup.
 */
export function restorePromptDue(activityCount: number, backupFound: boolean): boolean {
  return backupFound && activityCount === 0 && !isPlatformRecordAnswered();
}

/** The record zip left in the documents directory, when the engine would restore it. */
async function deviceRecord(): Promise<FoundBackup | null> {
  const uri = platformRecordUri();
  if (!uri) return null;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || ('size' in info && !(info.size ?? 0))) return null;
  // One the engine refuses would only be refused again on Restore.
  await checkRecordBackup(uri);
  const size = 'size' in info ? (info.size ?? 0) : 0;
  const modified = 'modificationTime' in info ? (info.modificationTime ?? 0) : 0;
  return {
    source: 'device',
    backend: null,
    entry: {
      id: uri,
      timestamp: new Date(modified * 1000).toISOString(),
      sizeBytes: size,
      appVersion: '',
    },
  };
}

async function newestListed(
  source: BackupSource,
  backend: BackupBackend
): Promise<FoundBackup | null> {
  const entries = await backend.listBackups();
  const newest = entries.reduce<BackupEntry | null>(
    (best, entry) =>
      best === null || Date.parse(entry.timestamp) > Date.parse(best.timestamp) ? entry : best,
    null
  );
  return newest ? { source, backend, entry: newest } : null;
}

/**
 * The newest backup that can be seen without asking the athlete for anything,
 * with where it was found, or null: a record zip left in the documents
 * directory that was not applied, a configured WebDAV server, a signed-in
 * Google Drive or, on iPhone, Veloq's own iCloud Drive folder. A place that
 * cannot be read holds none.
 */
export async function findNewestBackup(): Promise<FoundBackup | null> {
  const lookups: (() => Promise<FoundBackup | null>)[] = [
    deviceRecord,
    async () => {
      await initWebdavConfig();
      return getWebdavConfig() ? newestListed('webdav', webdavBackend) : null;
    },
    async () =>
      (await googleDriveBackend.isAvailable())
        ? newestListed('googleDrive', googleDriveBackend)
        : null,
    // Listed whatever the switch says: a reinstall has forgotten it, and the
    // folder still holds what the earlier install wrote.
    async () => (isIcloudSupported() ? newestListed('icloud', icloudBackend) : null),
  ];
  let newest: FoundBackup | null = null;
  for (const lookup of lookups) {
    const found = await lookup().catch(() => null);
    if (
      found &&
      (newest === null || Date.parse(found.entry.timestamp) > Date.parse(newest.entry.timestamp))
    ) {
      newest = found;
    }
  }
  return newest;
}

/** Restore the backup the offer named, fetching it first unless it is on the phone. */
export async function restoreFoundBackup(found: FoundBackup): Promise<RestoreOutcome> {
  if (found.backend) return restoreBackendEntry(found.backend, found.entry);
  await restoreRecordBackup(found.entry.id);
  return 'restored';
}

/** Record that the athlete has been asked, so the offer never returns. */
export function answerRestorePrompt(): void {
  markPlatformRecordAnswered();
  useWhatsNewStore.getState().setRestoreOffer(null);
}

/**
 * Offers the restore once the library is known to be empty: when the launch
 * found no activities, a backup can be seen and nothing has answered the offer.
 * `isCurrent` is read before and after the backup lookup, so a launch that has
 * been superseded in the meantime offers nothing. The feed's card shows the
 * offer until it is answered.
 */
export async function offerRestorePrompt(
  launchCount: number,
  isCurrent: () => boolean
): Promise<void> {
  if (launchCount > 0 || !isCurrent()) return;
  const found = await findNewestBackup();
  if (found && isCurrent() && restorePromptDue(launchCount, true)) {
    useWhatsNewStore.getState().setRestoreOffer(found);
  }
}
