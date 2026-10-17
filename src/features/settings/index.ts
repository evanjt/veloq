export {
  MapPreferencesProvider,
  useMapPreferences,
  useMapPreferenceActions,
  forgetActivityMapOverrides,
} from './stores/MapPreferencesContext';
export type { ActivityCameraState } from './stores/MapPreferencesContext';
export {
  useDashboardPreferences,
  initialiseDashboardPreferences,
  getMetricDefinition,
  AVAILABLE_METRICS,
  HERO_METRICS,
  isHeroMetricId,
  type HeroMetricId,
  type MetricId,
  type MetricDefinition,
  type SummaryCardPreferences,
} from './stores/summaryCardPreferences';
export { useBackgroundJobs } from './hooks/useBackgroundJobs';
export type { BackgroundJob, BackgroundJobId, BackgroundJobState } from './hooks/useBackgroundJobs';
export { useNotificationPreferences } from './stores/NotificationPreferencesStore';
export type { NotificationPreferences } from './stores/NotificationPreferencesStore';
export { LibraryRebuiltNotice } from './components/LibraryRebuiltNotice';
export { RestoreOfferCard } from './components/RestoreOfferCard';
export { useLaunchSurfaces } from './hooks/useLaunchSurfaces';
export { RestoreChooser } from './components/RestoreChooser';
export { captureQuarantineReport } from './lib/quarantineReport';
export { cleanUpRetiredBackupSettings } from './lib/autobackup/autoBackup';
export { excludeLocalBackupsFromDeviceBackup } from './lib/autobackup/backends/localBackend';
export { applyOpenedBackup, receiveOpenedBackup } from './lib/openedBackup';
export { runLaunchRestores } from './lib/launchRestore';
export { useLastBackupTimestamp, useAutoBackupEnabled } from './hooks/useLastBackupTimestamp';
export { resumeRecordImport } from './lib/backup';
export { sweepIdleBackupFiles } from './lib/backupCache';
export { settingsStyles } from './components/settingsStyles';
export { StreamConsentCard } from './components/StreamConsentCard';
export { useDebugStore, initialiseDebugStore } from './stores/DebugStore';
export {
  getNotificationPreferences,
  initialiseNotificationPreferences,
  isPrivacyNoticeOwed,
} from './stores/NotificationPreferencesStore';
export {
  useNotificationPrompt,
  initialiseNotificationPrompt,
} from './stores/NotificationPromptStore';
export { initialiseWhatsNewStore } from './stores/WhatsNewStore';
export { onAppForeground, initWebdavConfig } from './lib/autobackup';
export { refreshPushTokenRegistration, registerPushToken } from './lib/pushTokenRegistration';
export {
  reconcilePushRegistrationOnLaunch,
  reconcilePushRegistrationOnForeground,
} from './lib/reconcilePushRegistration';
export { withDatabaseSnapshot } from './lib/clearSnapshot';
export { useGpxExport, useImportDatabaseBackup } from './hooks/exportIndex';
export { WhatsNewModal, TourReturnPill } from './components/whatsNew';
export {
  ActivitySyncRow,
  BackgroundJobsActivityBar,
  BackupSection,
  CutoverStatus,
  DataAttribution,
  DataCacheSection,
  DataSourcesSection,
  DisplaySettings,
  ElevationBackfillStatus,
  FooterSection,
  MapsSection,
  NotificationSection,
  PlaceNamesSwitch,
  ProfileAccountSection,
  RecordingPermissionSection,
  SettingsNavRow,
  SummaryCardSection,
  SupportSection,
  SyncRangePanel,
} from './components';
export {
  initialiseNotifications,
  setupNotificationReceivedHandler,
  setupNotificationResponseHandler,
  handleInitialNotificationResponse,
  requestNotificationPermission,
  presentActivityNotification,
} from './lib/notificationService';
