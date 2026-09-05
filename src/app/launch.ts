import { initializeSportPreference, initializeHRZones } from '@/features/fitness/stores';
import { initializeDashboardPreferences } from '@/features/home/store';
import { initializeInsightsStore } from '@/features/insights/store';
import { initializeTileCacheSettings } from '@/features/maps/lib/storage/tileCacheSettings';
import { initializeRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { initializeUploadPermission } from '@/features/recording/stores/UploadPermissionStore';
import { initializeRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { initializeHeatmapPreference } from '@/features/maps/stores/HeatmapPreferenceStore';
import { initializeDebugStore } from '@/features/settings/stores/DebugStore';
import { initializeNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { initializeNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { initializeWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { initializeLanguage } from '@/shared/app/LanguageStore';
import { initializeSupportStore } from '@/shared/app/SupportStore';
import { initializeTheme } from '@/shared/app/ThemeProvider';
import { initializeUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { getEngine, getRouteDbPath } from '@/shared/native/engine';
import { initializeI18n } from '@/i18n';

/** A `launch:` mark survives a release build, so a trace can split the JS window. */
function markLaunch(step: 'auth' | 'engine' | 'stores'): void {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(`launch:${step}`);
  }
}

/**
 * Open the library before the stores read their settings, so every read is
 * one SQLite lookup instead of a round trip to AsyncStorage. A launch with no
 * credentials leaves the engine closed, as the login screen expects. Failure
 * is left to `AuthGate`, which retries and raises the banner.
 */
function openEngine(): void {
  if (!useAuthStore.getState().isAuthenticated) return;
  const engine = getEngine();
  const dbPath = getRouteDbPath();
  if (!engine || !dbPath) return;
  engine.initWithPath(dbPath);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason ?? 'Unknown startup error');
}

/**
 * Restore every store the first screen reads. Resolves to the first
 * initialiser's error message, or null when all of them settled.
 */
export async function initializeApp(): Promise<string | null> {
  markLaunch('auth');
  await useAuthStore.getState().initialize();
  markLaunch('engine');
  openEngine();
  markLaunch('stores');
  const results = await Promise.allSettled([
    initializeLanguage().then(initializeI18n),
    initializeTheme(),
    initializeSportPreference(),
    initializeUnitPreference(),
    initializeHRZones(),
    initializeRouteSettings(),
    initializeHeatmapPreference(),
    initializeDashboardPreferences(),
    initializeDebugStore(),
    initializeTileCacheSettings(),
    initializeWhatsNewStore(),
    initializeInsightsStore(),
    initializeRecordingPreferences(),
    initializeUploadPermission(),
    initializeNotificationPreferences(),
    initializeNotificationPrompt(),
    initializeSupportStore(),
  ]);
  const failed = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failed.length === 0) return null;
  const message = errorMessage(failed[0].reason);
  if (__DEV__) {
    console.warn(`[AppInit] ${failed.length} initializer(s) failed. First error: ${message}`);
  }
  return message;
}
