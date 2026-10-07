/**
 * One-time migration: AsyncStorage preferences → SQLite settings table.
 *
 * Runs on app boot after the Rust engine initializes. Idempotent - uses
 * separate sentinels for the initial copy and missing-preference repair.
 * Does NOT delete AsyncStorage keys (backward compat for one release).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getEngine } from '@/shared/native/engine';
import { debug } from '@/shared/debug/debug';

/**
 * Set once the migration below has copied everything across. `getSetting`
 * reads it to decide whether an absent key is worth asking AsyncStorage for.
 */
export const SETTINGS_MIGRATED_KEY = '__settings_migrated';
const REPAIRED_SETTINGS_KEY = '__settings_missing_preferences_migrated';

// Only these omitted keys may be recovered after the original migration.
const REPAIR_KEYS = [
  'veloq-known-sensors',
  'veloq-support-store',
  'veloq-notification-prompt-dismissed',
  'veloq-heatmap-enabled',
  'veloq-track-fetch-dismissed',
] as const;

/** All AsyncStorage keys that should be consolidated into SQLite. */
export const PREFERENCE_KEYS = [
  'veloq-theme-preference',
  'veloq-language-preference',
  'veloq-unit-preference',
  'veloq-primary-sport',
  'veloq-map-preferences',
  'veloq-route-settings',
  'veloq-map-routes-visible',
  'veloq-debug-mode',
  'dashboard_summary_card',
  '@terrain_camera_overrides',
  '@map_camera_state',
  'veloq-map-activity-overrides',
  'veloq-tile-cache',
  'veloq-whats-new-seen',
  'veloq-insights-fingerprint',
  'veloq-recording-preferences',
  'veloq-insight-push-history',
  'veloq-notification-preferences',
  'veloq-upload-permission',
  ...REPAIR_KEYS,
] as const;

/**
 * Keys an older build kept in AsyncStorage. The migration copies the section
 * and route id ones it knows into the settings table and leaves the originals,
 * and a converted old backup can carry any of them, so the wipe removes all of
 * them from both sides. The push history key has no reader or writer left.
 */
export const LEGACY_LIBRARY_KEYS = [
  'veloq-disabled-sections',
  'veloq-superseded-sections',
  'veloq-section-dismissals',
  'veloq-geocoded-route-ids',
  'veloq-geocoded-section-ids',
  'veloq-insight-push-history',
] as const;

/**
 * Migrate AsyncStorage preferences to the SQLite settings table.
 * Call after VeloqEngine.create() on app boot.
 */
export async function migrateSettingsToSqlite(): Promise<void> {
  const engine = getEngine();
  if (!engine) return;

  await copyMissingPreferences(engine, PREFERENCE_KEYS, SETTINGS_MIGRATED_KEY);
  await copyMissingPreferences(engine, REPAIR_KEYS, REPAIRED_SETTINGS_KEY);
  clearStoredTerrainFailures(engine);
}

const ACTIVITY_OVERRIDES_KEY = 'veloq-map-activity-overrides';
export const TERRAIN_CLEANUP_DONE_KEY = 'veloq-terrain-override-cleanup-done';

/**
 * Older builds wrote `terrain3D: false` into an activity's map override when a
 * terrain load failed once, which kept 3D off for that activity for good. Runs
 * once: drops every such field and leaves each override's style alone.
 */
function clearStoredTerrainFailures(engine: NonNullable<ReturnType<typeof getEngine>>): void {
  if (engine.getSetting(TERRAIN_CLEANUP_DONE_KEY) !== undefined) return;
  const raw = engine.getSetting(ACTIVITY_OVERRIDES_KEY);
  if (raw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const cleaned: Record<string, unknown> = {};
      let changed = false;
      for (const [id, entry] of Object.entries(parsed)) {
        if (typeof entry === 'object' && entry !== null && 'terrain3D' in entry) {
          const { terrain3D, ...rest } = entry as Record<string, unknown>;
          if (terrain3D === false) {
            changed = true;
            if (Object.keys(rest).length > 0) cleaned[id] = rest;
            continue;
          }
        }
        cleaned[id] = entry;
      }
      if (changed) engine.setSetting(ACTIVITY_OVERRIDES_KEY, JSON.stringify(cleaned));
    }
  }
  engine.setSetting(TERRAIN_CLEANUP_DONE_KEY, '1');
}

async function copyMissingPreferences(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  keys: readonly string[],
  sentinelKey: string
): Promise<void> {
  if (engine.getSetting(sentinelKey) !== undefined) return;
  let complete = true;
  let migrated = 0;
  for (const key of keys) {
    try {
      if (engine.getSetting(key) !== undefined) continue;
      const value = await AsyncStorage.getItem(key);
      // A store can write a newer value while the legacy read is pending.
      if (value !== null && engine.getSetting(key) === undefined) {
        engine.setSetting(key, value);
        migrated++;
      }
    } catch {
      complete = false;
    }
  }
  // Failed reads or writes must remain eligible for the next boot's retry.
  if (complete) engine.setSetting(sentinelKey, '1');
  debug.log(`[Settings Migration] ${sentinelKey}: ${migrated} keys copied, complete=${complete}`);
}
