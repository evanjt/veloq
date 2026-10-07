/**
 * The one-time offer to restore on an empty signed-in library.
 *
 * The platform record zip restores itself. A library with no zip to apply, or
 * one the engine refused, is otherwise left empty with no word that a backup in
 * a file or on a WebDAV server exists. The offer is answered once, by sharing
 * the platform record's marker: a restore or a dismissal both mean the athlete
 * has been asked.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { platformRecordUri } from '@/shared/storage/platformRecord';
import { isPlatformRecordAnswered, markPlatformRecordAnswered } from './autobackup/autoBackup';
import { webdavBackend } from './autobackup/backends';
import { getWebdavConfig, initWebdavConfig } from './autobackup/webdavConfig';

/**
 * Whether to offer a restore. `activityCount` is read before the launch sync.
 * A first launch with no backup found offers nothing: restoring from a file or
 * a server stays in Settings, Backup.
 */
export function restorePromptDue(activityCount: number, backupFound: boolean): boolean {
  return backupFound && activityCount === 0 && !isPlatformRecordAnswered();
}

/**
 * Whether a backup can be seen without asking the athlete for anything: a
 * record zip left in the documents directory that was not applied, or a
 * configured WebDAV server that lists at least one backup.
 */
export async function backupIsFound(): Promise<boolean> {
  try {
    const uri = platformRecordUri();
    if (uri) {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && (!('size' in info) || (info.size ?? 0) > 0)) return true;
    }
  } catch {
    // An unreadable directory is no backup found.
  }
  try {
    await initWebdavConfig();
    if (!getWebdavConfig()) return false;
    return (await webdavBackend.listBackups()).length > 0;
  } catch {
    return false;
  }
}

/** Record that the athlete has been asked, so the offer never returns. */
export function answerRestorePrompt(): void {
  markPlatformRecordAnswered();
}
