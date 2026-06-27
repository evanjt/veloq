export * from './components';
export { WhatsNewModal, TourReturnPill } from './components/whatsNew';

export {
  useGpxExport,
  useExportDatabaseBackup,
  useImportDatabaseBackup,
  useBulkExport,
} from './hooks/exportIndex';

export {
  generateGpx,
  shareFile,
  createBackup,
  exportBackup,
  restoreBackup,
  type RestoreResult,
  exportDatabaseBackup,
  restoreDatabaseBackup,
  getDatabaseBackupMetadata,
  reinitializeAllStores,
  type DatabaseBackupMetadata,
  type DatabaseRestoreResult,
} from './lib/exportIndex';
export {
  bulkExportActivities,
  bulkExportActivitiesGeoJson,
  type BulkExportPhase,
  type BulkExportProgress,
  type BulkExportResult,
} from './lib/bulkExport';

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
  testWebdavConnection,
  type BackupBackend,
  type BackupEntry,
} from './lib/autobackup/index';

export {
  initializeNotifications,
  requestNotificationPermission,
  hasNotificationPermission,
  presentInsightNotification,
  presentActivityNotification,
  updateSyncNotification,
  dismissSyncNotification,
  setupNotificationReceivedHandler,
  setupNotificationResponseHandler,
  handleInitialNotificationResponse,
  type InsightNotificationData,
} from './lib/notificationService';
export {
  getExpoPushToken,
  registerPushToken,
  unregisterPushToken,
} from './lib/pushTokenRegistration';

export {
  useNotificationPreferences,
  getNotificationPreferences,
  initializeNotificationPreferences,
  retryPendingUnregister,
  type NotificationPreferences,
} from './stores/NotificationPreferencesStore';
export {
  useNotificationPrompt,
  initializeNotificationPrompt,
} from './stores/NotificationPromptStore';
export { useSupportStore, initializeSupportStore, daysSince } from '@/shared/app/SupportStore';
export { useWhatsNewStore, initializeWhatsNewStore } from './stores/WhatsNewStore';
export { useDebugStore, isDebugEnabled, initializeDebugStore } from './stores/DebugStore';
