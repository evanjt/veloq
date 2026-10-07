import type { BackupBackend } from './types';
import { folderBackend } from './folderBackend';
import { webdavBackend } from './webdavBackend';

/**
 * Every place an automatic backup writes the record zip. A run hands the zip
 * to each one whose `isAvailable` is true, so the athlete does not pick one.
 */
export const backupCarriers: BackupBackend[] = [webdavBackend, folderBackend];
