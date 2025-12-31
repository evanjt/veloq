export { QueryProvider } from './QueryProvider';
export {
  initializeTheme,
  setThemePreference,
  getThemePreference,
  type ThemePreference,
} from './ThemeProvider';
export {
  MapPreferencesProvider,
  useMapPreferences,
  type MapPreferences,
} from './MapPreferencesContext';
export { useAuthStore, getStoredCredentials, DEMO_ATHLETE_ID, type AuthMethod } from './AuthStore';
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
// RouteMatchStore has been replaced by Rust persistent engine.
// Use hooks from src/hooks/routes/useRouteEngine.ts instead.
export {
  useRouteSettings,
  isRouteMatchingEnabled,
  initializeRouteSettings,
} from './RouteSettingsStore';
export {
  useLanguageStore,
  initializeLanguage,
  getEffectiveLanguage,
  getAvailableLanguages,
  isEnglishVariant,
  getEnglishVariantValue,
} from './LanguageStore';
export { useSyncDateRange } from './SyncDateRangeStore';
export { NetworkProvider, useNetwork } from './NetworkContext';
