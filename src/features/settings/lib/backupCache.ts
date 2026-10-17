import * as FileSystem from 'expo-file-system/legacy';

import { EXPORTS_DIR } from '@/shared/storage/cacheFiles';
import { RECORD_TEMP_PREFIX } from '@/shared/storage/platformRecord';
import { debug } from '@/shared/debug/debug';
import { inBackupSlot } from './backupSlot';
import { BULK_EXPORT_EXTENSION, BULK_EXPORT_PREFIX } from './bulkExportFormat';
import { AUTOBACKUP_SNAPSHOT_PREFIX, SHARE_COPY_PREFIX } from './autobackup/backends/localBackend';

const log = debug.create('BackupCache');

async function sweepDirectory(dir: string, matches: (name: string) => boolean): Promise<void> {
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(dir);
  } catch (error) {
    log.warn('Could not list backup temporaries:', error);
    return;
  }
  for (const name of names.filter(matches)) {
    try {
      await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
    } catch (error) {
      log.warn('Could not delete backup temporary:', error);
    }
  }
}

// The caller holds the backup slot until sweeping, writing and sharing have settled.
export async function sweepBackupFiles(): Promise<void> {
  const cacheDir = FileSystem.cacheDirectory;
  if (cacheDir) {
    await sweepDirectory(
      `${cacheDir}${EXPORTS_DIR}`,
      (name) =>
        (name.startsWith(SHARE_COPY_PREFIX) && name.endsWith('.zip')) ||
        name.startsWith(RECORD_TEMP_PREFIX)
    );
    await sweepDirectory(
      cacheDir,
      (name) =>
        (name.startsWith(SHARE_COPY_PREFIX) || name.startsWith(AUTOBACKUP_SNAPSHOT_PREFIX)) &&
        name.endsWith('.veloqdb')
    );
  }
  const docDir = FileSystem.documentDirectory;
  if (docDir) await sweepDirectory(docDir, (name) => name.startsWith(RECORD_TEMP_PREFIX));
}

/**
 * Delete the archives earlier bulk exports handed to the share sheet. A share
 * target may read its file after the sheet returns, so each one is kept until
 * the next export or the next launch. Not part of `sweepBackupFiles`: the
 * record export runs that while a bulk export may still be writing.
 */
export async function sweepBulkExportFiles(): Promise<void> {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) return;
  const extensions = Object.values(BULK_EXPORT_EXTENSION).map((extension) => `.${extension}`);
  await sweepDirectory(
    `${cacheDir}${EXPORTS_DIR}`,
    (name) =>
      name.startsWith(BULK_EXPORT_PREFIX) &&
      extensions.some((extension) => name.endsWith(extension))
  );
}

/**
 * The launch sweep. The bulk archives go first and outside the backup slot,
 * since a sweep queued behind a long backup could land on an export started
 * meanwhile.
 */
export async function sweepIdleBackupFiles(): Promise<void> {
  await sweepBulkExportFiles();
  await inBackupSlot(sweepBackupFiles);
}
