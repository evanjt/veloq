import * as FileSystem from 'expo-file-system/legacy';

import { EXPORTS_DIR } from '@/shared/storage/cacheFiles';
import { RECORD_TEMP_PREFIX } from '@/shared/storage/platformRecord';
import { debug } from '@/shared/debug/debug';
import { inBackupSlot } from './backupSlot';
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

export function sweepIdleBackupFiles(): Promise<void> {
  return inBackupSlot(sweepBackupFiles);
}
