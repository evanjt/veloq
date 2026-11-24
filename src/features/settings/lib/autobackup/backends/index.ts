export type { BackupBackend, BackupEntry } from './types';
export { localBackend } from './localBackend';
export { webdavBackend, testWebdavConnection } from './webdavBackend';
export {
  folderBackend,
  pickBackupFolder,
  getBackupFolderName,
  forgetBackupFolder,
  isSharedBackupFolder,
  stopBackupFolder,
} from './folderBackend';
export { googleDriveBackend } from './googleDriveBackend';
export { icloudBackend, isIcloudSupported } from './icloudBackend';
