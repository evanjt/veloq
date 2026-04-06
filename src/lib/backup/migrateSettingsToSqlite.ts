/**
 * One-time migration: AsyncStorage preferences → SQLite settings table.
 *
 * Runs on app boot after the Rust engine initializes. Idempotent — uses
 * a sentinel key (__settings_migrated) to skip on subsequent boots.
 * Does NOT delete AsyncStorage keys (backward compat for one release).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { debug } from '@/lib/utils/debug';

const SENTINEL_KEY = '__settings_migrated';

/** All AsyncStorage keys that should be consolidated into SQLite. */
export const PREFERENCE_KEYS = [
  'veloq-theme-preference',
  'veloq-language-preference',
  'veloq-unit-preference',
  'veloq-primary-sport',
  'veloq-map-preferences',
  'veloq-route-settings',
  'veloq-hr-zones',
  'veloq-debug-mode',
  'veloq-disabled-sections',
  'veloq-section-dismissals',
  'veloq-superseded-sections',
  'veloq-potential-sections',
  'dashboard_preferences',
  'dashboard_summary_card',
  '@terrain_camera_overrides',
  '@map_camera_state',
  'veloq-map-activity-overrides',
  'veloq-tile-cache',
  'veloq-whats-new-seen',
  'veloq-insights-fingerprint',
  'veloq-recording-preferences',
  'veloq-geocoded-route-ids',
  'veloq-geocoded-section-ids',
  'veloq-notification-preferences',
  'veloq-upload-permission',
] as const;

/**
 * Migrate AsyncStorage preferences to the SQLite settings table.
 * Call after VeloqEngine.create() on app boot.
 */
export async function migrateSettingsToSqlite(): Promise<void> {
  const engine = getRouteEngine();
  if (!engine) return;

  // Check sentinel — skip if already migrated
  const alreadyMigrated = engine.getSetting(SENTINEL_KEY);
  if (alreadyMigrated) return;

  debug.log('[Settings Migration] Starting AsyncStorage → SQLite migration');
  let migrated = 0;

  for (const key of PREFERENCE_KEYS) {
    try {
      const value = await AsyncStorage.getItem(key);
      if (value !== null) {
        engine.setSetting(key, value);
        migrated++;
      }
    } catch {
      // Skip unreadable keys
    }
  }

  // Set sentinel to prevent re-running
  engine.setSetting(SENTINEL_KEY, '1');
  debug.log(`[Settings Migration] Complete: ${migrated} keys migrated`);
}
