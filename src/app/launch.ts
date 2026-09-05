import { initializeSportPreference, initializeHRZones } from '@/features/fitness/stores';
import { initializeDashboardPreferences } from '@/features/home/store';
import { initializeInsightsStore } from '@/features/insights/store';
import {
  initializeTileCacheSettings,
  migrateTileCacheSettings,
} from '@/features/maps/lib/storage/tileCacheSettings';
import { initializeRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { initializeUploadPermission } from '@/features/recording/stores/UploadPermissionStore';
import { initializeRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { initializeDebugStore } from '@/features/settings/stores/DebugStore';
import { initializeNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { initializeNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { initializeWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { initializeLanguage } from '@/shared/app/LanguageStore';
import { initializeSupportStore, useSupportStore } from '@/shared/app/SupportStore';
import { initializeTheme } from '@/shared/app/ThemeProvider';
import { initializeUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { getEngine } from '@/shared/native/engine';
import { initializeI18n } from '@/i18n';

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason ?? 'Unknown startup error');
}

/**
 * Restore every store the first screen reads. Resolves to the first
 * initialiser's error message, or null when all of them settled.
 */
export async function initializeApp(): Promise<string | null> {
  const savedLocale = await initializeLanguage();
  await initializeI18n(savedLocale);
  const results = await Promise.allSettled([
    initializeTheme(),
    useAuthStore.getState().initialize(),
    initializeSportPreference(),
    initializeUnitPreference(),
    initializeHRZones(),
    initializeRouteSettings(),
    initializeDashboardPreferences(),
    initializeDebugStore(),
    migrateTileCacheSettings(),
    initializeTileCacheSettings(),
    initializeWhatsNewStore(),
    initializeInsightsStore(),
    initializeRecordingPreferences(),
    initializeUploadPermission(),
    initializeNotificationPreferences(),
    initializeNotificationPrompt(),
    initializeSupportStore(),
  ]);
  const support = useSupportStore.getState();
  if (support.isLoaded && !support.isLegacyPurchaser) {
    try {
      const eng = getEngine();
      if (eng && eng.getActivityCount() > 0) {
        support.setLegacyPurchaser();
      }
    } catch {
      // Engine not available yet - skip, will be a new user
    }
  }
  const failed = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failed.length > 0) {
    const message = errorMessage(failed[0].reason);
    if (__DEV__) {
      console.warn(`[AppInit] ${failed.length} initializer(s) failed. First error: ${message}`);
    }
    return message;
  }
  return null;
}
