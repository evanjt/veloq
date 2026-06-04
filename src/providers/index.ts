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
} from './MapPreferencesContext';
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
} from './SportPreferenceStore';
export {
  useHRZones,
  getHRZones,
  initializeHRZones,
  DEFAULT_HR_ZONES,
  type HRZone,
  type HRZonesSettings,
} from './HRZonesStore';
export {
  usePotentialSections,
  getPotentialSections,
  initializePotentialSections,
} from './PotentialSectionsStore';
export {
  useSectionDismissals,
  getSectionDismissals,
  initializeSectionDismissals,
} from './SectionDismissalsStore';
export { useSupersededSections, initializeSupersededSections } from './SupersededSectionsStore';
export { useDisabledSections, initializeDisabledSections } from './DisabledSectionsStore';
// RouteMatchStore has been replaced by Rust persistent engine.
// Use hooks from src/hooks/routes/useRouteEngine.ts instead.
export {
  useRouteSettings,
  isRouteMatchingEnabled,
  isGeocodingEnabled,
  initializeRouteSettings,
} from './RouteSettingsStore';
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
} from './SyncDateRangeStore';
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
export { useEngineStatus } from './EngineStatusStore';
export { useTileCacheStore, initializeTileCacheStore } from './TileCacheStore';
export { useWhatsNewStore, initializeWhatsNewStore } from './WhatsNewStore';
export {
  useInsightsStore,
  initializeInsightsStore,
  computeInsightFingerprint,
  diffInsights,
} from './InsightsStore';
export {
  useNotificationPreferences,
  getNotificationPreferences,
  initializeNotificationPreferences,
  type NotificationPreferences,
} from './NotificationPreferencesStore';
export { useRecordingStore, getRecordingStatus } from './RecordingStore';
export {
  useRecordingPreferences,
  initializeRecordingPreferences,
} from './RecordingPreferencesStore';
export { useUploadPermissionStore, initializeUploadPermission } from './UploadPermissionStore';
export { useNotificationPrompt, initializeNotificationPrompt } from './NotificationPromptStore';
export { useSupportStore, initializeSupportStore, daysSince } from './SupportStore';
