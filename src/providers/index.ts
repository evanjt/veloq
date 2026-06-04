export { QueryProvider, queryClient } from '@/shared/query/QueryProvider';
export {
  initializeTheme,
  setThemePreference,
  getThemePreference,
  useThemePreferenceStore,
  useResolvedColorScheme,
  type ThemePreference,
} from '@/shared/app/ThemeProvider';
export {
  MapPreferencesProvider,
  useMapPreferences,
  type MapPreferences,
  type ActivityMapOverride,
} from '@/features/maps/stores/MapPreferencesContext';
export {
  useAuthStore,
  getStoredCredentials,
  DEMO_ATHLETE_ID,
  type AuthMethod,
  type SessionExpiredReason,
} from '@/features/auth/store';
export {
  useSportPreference,
  getPrimarySport,
  initializeSportPreference,
  SPORT_API_TYPES,
  SPORT_COLORS,
  type PrimarySport,
} from '@/features/fitness/stores';
export {
  useHRZones,
  getHRZones,
  initializeHRZones,
  DEFAULT_HR_ZONES,
  type HRZone,
  type HRZonesSettings,
} from '@/features/fitness/stores';
export {
  usePotentialSections,
  getPotentialSections,
  initializePotentialSections,
} from '@/features/routes/stores/PotentialSectionsStore';
export {
  useSectionDismissals,
  getSectionDismissals,
  initializeSectionDismissals,
} from '@/features/routes/stores/SectionDismissalsStore';
export {
  useSupersededSections,
  initializeSupersededSections,
} from '@/features/routes/stores/SupersededSectionsStore';
export {
  useDisabledSections,
  initializeDisabledSections,
} from '@/features/routes/stores/DisabledSectionsStore';
// RouteMatchStore has been replaced by Rust persistent engine.
// Use hooks from src/features/routes/hooks/useRouteEngine.ts instead.
export {
  useRouteSettings,
  isRouteMatchingEnabled,
  isGeocodingEnabled,
  initializeRouteSettings,
} from '@/features/routes/stores/RouteSettingsStore';
export {
  useLanguageStore,
  initializeLanguage,
  getEffectiveLanguage,
  getAvailableLanguages,
  isEnglishVariant,
  getEnglishVariantValue,
  isLanguageVariant,
  getBaseLanguage,
} from '@/shared/app/LanguageStore';
export {
  useSyncDateRange,
  getSyncGeneration,
  type GpsSyncProgress,
  type TerrainSnapshotProgress,
} from '@/features/routes/stores/SyncDateRangeStore';
export { NetworkProvider, useNetwork } from '@/shared/app/NetworkContext';
export {
  TopSafeAreaProvider,
  useTopSafeArea,
  useScreenSafeAreaEdges,
} from '@/shared/app/TopSafeAreaContext';
export {
  useUnitPreference,
  getIsMetric,
  resolveIsMetric,
  getIntervalsPreferenceLabel,
  initializeUnitPreference,
  type UnitPreference,
  type IntervalsUnitPreferences,
} from '@/shared/app/UnitPreferenceStore';
export {
  useDashboardPreferences,
  initializeDashboardPreferences,
  getMetricDefinition,
  getMetricsForSport,
  AVAILABLE_METRICS,
  type MetricId,
  type MetricDefinition,
  type MetricPreference,
} from '@/features/home/store';
export { useDebugStore, isDebugEnabled, initializeDebugStore } from './DebugStore';
export { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
export { useTileCacheStore, initializeTileCacheStore } from '@/features/maps/stores/TileCacheStore';
export { useWhatsNewStore, initializeWhatsNewStore } from './WhatsNewStore';
export {
  useInsightsStore,
  initializeInsightsStore,
  computeInsightFingerprint,
  diffInsights,
} from '@/features/insights/store';
export {
  useNotificationPreferences,
  getNotificationPreferences,
  initializeNotificationPreferences,
  type NotificationPreferences,
} from './NotificationPreferencesStore';
export { useRecordingStore, getRecordingStatus } from '@/features/recording/stores/RecordingStore';
export {
  useRecordingPreferences,
  initializeRecordingPreferences,
} from '@/features/recording/stores/RecordingPreferencesStore';
export {
  useUploadPermissionStore,
  initializeUploadPermission,
} from '@/features/recording/stores/UploadPermissionStore';
export { useNotificationPrompt, initializeNotificationPrompt } from './NotificationPromptStore';
export { useSupportStore, initializeSupportStore, daysSince } from './SupportStore';
