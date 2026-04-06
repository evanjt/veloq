export { migrateSettingsToSqlite, PREFERENCE_KEYS } from './migrateSettingsToSqlite';
export { getSetting, setSetting, removeSetting } from './settingsStorage';
export {
  performBackup,
  onSyncComplete,
  onAppBackground,
  onAppForeground,
  getConfiguredBackend,
  setBackendPreference,
  isAutoBackupEnabled,
  setAutoBackupEnabled,
  getAvailableBackends,
  getLastBackupTimestamp,
  registerBackend,
  getWebdavConfig,
  initWebdavConfig,
  setWebdavConfig,
  clearWebdavConfig,
} from './autoBackup';
export { testWebdavConnection } from './backends';
export type { BackupBackend, BackupEntry } from './backends';
