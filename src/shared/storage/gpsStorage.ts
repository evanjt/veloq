/**
 * FileSystem cleanup and size measurement for the caches the app writes outside Rust.
 *
 * GPS track storage functions have been removed - all GPS data is now stored
 * exclusively in the Rust SQLite engine (routes.db gps_tracks table).
 * The clearAllGpsTracks() function is retained for cleanup of any legacy files.
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';

import { debug } from '@/shared/debug/debug';
import { getEngine, getRouteDbPath } from '@/shared/native/engine';
import { readHeatmapTilesCacheSize } from '@/features/maps/hooks/useHeatmapTiles';
import {
  clearTerrainPreviews,
  getTerrainPreviewCacheSize,
} from '@/features/maps/lib/storage/terrainPreviewCache';
import { forgetCachedAthleteId, forgetStoredActivityCount } from './cachedAthleteId';
import { forgetInsightFingerprint } from '@/features/insights/lib/fingerprintStore';

const log = debug.create('GpsStorage');

const GPS_DIR = `${FileSystem.documentDirectory}gps_tracks/`;

/**
 * Clear all legacy GPS track files (cleanup only).
 * GPS data is now stored in the Rust SQLite engine.
 */
export async function clearAllGpsTracks(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(GPS_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(GPS_DIR, { idempotent: true });
      log.log('Cleared legacy GPS tracks directory');
    }
  } catch {
    // Best effort cleanup
  }
}

/**
 * Delete legacy GPS track files by activity ID (cleanup only).
 */
export async function deleteGpsTracks(activityIds: string[]): Promise<void> {
  if (activityIds.length === 0) return;

  const results = await Promise.allSettled(
    activityIds.map((id) => {
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
      return FileSystem.deleteAsync(`${GPS_DIR}${safeId}.json`, { idempotent: true });
    })
  );

  const failedCount = results.filter((r) => r.status === 'rejected').length;
  if (failedCount > 0) {
    log.log(`Warning: ${failedCount}/${activityIds.length} GPS track deletes failed`);
  }
}

// =============================================================================
// Cache files owned by the account wipe below
// =============================================================================

const CACHE_DIR = `${FileSystem.documentDirectory}bounds_cache/`;
const BOUNDS_CACHE_FILE = `${CACHE_DIR}bounds.json`;
const ROUTE_NAMES_FILE = `${CACHE_DIR}route_names.json`;

export async function clearBoundsCache(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(BOUNDS_CACHE_FILE);
    if (info.exists) {
      await FileSystem.deleteAsync(BOUNDS_CACHE_FILE, { idempotent: true });
      log.log('Cleared bounds cache');
    }
  } catch {
    // Best effort
  }
}

// =============================================================================
// Routes Database Size (Rust SQLite)
// =============================================================================

// Asked rather than spelled: since the database moved into the App Group
// container on iOS there is one answer and `engine.ts` holds it.
function routesDbPath(): string | null {
  const path = getRouteDbPath();
  return path === null ? null : `file://${path}`;
}

/**
 * Get the size of a single file, returning 0 if it doesn't exist.
 */
async function getFileSize(path: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists && 'size' in info) {
      return info.size || 0;
    }
  } catch {
    // Ignore
  }
  return 0;
}

/**
 * Estimate routes SQLite database size in bytes.
 * Includes the main .db file plus WAL and SHM journal files,
 * which can be substantial in WAL mode.
 */
export async function estimateRoutesDatabaseSize(): Promise<number> {
  const path = routesDbPath();
  if (path === null) return 0;
  const [main, wal, shm] = await Promise.all([
    getFileSize(path),
    getFileSize(`${path}-wal`),
    getFileSize(`${path}-shm`),
  ]);
  return main + wal + shm;
}

/**
 * One bucket's bytes, or zero if it cannot answer. A bucket that throws is
 * not worth losing the other three over: the figure is a subtitle, and the
 * engine is not open on every screen that reads it.
 */
async function bucketSize(read: () => number | bigint | Promise<number>): Promise<number> {
  try {
    return Number(await read()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Total app storage usage, as the sum of the four buckets that know their own
 * size.
 *
 * Three of them answer natively and the fourth is three files, so nothing here
 * touches the tile trees. Walking `documentDirectory` and `cacheDirectory`
 * instead cost one `getInfoAsync` round trip per tile, awaited in series on
 * the JS thread, over the two largest trees the app writes.
 */
export async function getAppStorageSize(): Promise<number> {
  const sizes = await Promise.all([
    bucketSize(estimateRoutesDatabaseSize),
    bucketSize(readHeatmapTilesCacheSize),
    bucketSize(() => {
      // Required lazily, not imported: `veloqrs` reaches the Turbo Module at
      // import time, and this module is imported by cleanup paths that run in
      // tests and on web, where that module does not exist.
      const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
      return basemapStore().getCacheSize();
    }),
    bucketSize(getTerrainPreviewCacheSize),
  ]);
  return sizes.reduce((total, size) => total + size, 0);
}

// =============================================================================
// Comprehensive Cache Clearing (for auth transitions)
// =============================================================================

/**
 * Lightweight cleanup for the "Sign out (keep data)" path.
 *
 * Drops the previous user's identity (athlete profile + sport settings caches
 * in Rust, plus the persisted TanStack Query blob) but leaves activities,
 * GPS tracks, sections, and bounds caches intact so the same user can log
 * back in and see their data instantly.
 */
export async function clearAuthOnly(queryClient: { clear: () => void }): Promise<void> {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  queryClient.clear();
  await AsyncStorage.removeItem('veloq-query-cache');

  const engine = getEngine();
  if (engine) engine.clearUserProfileCaches();

  log.log('Cleared auth-only caches (profile + query cache)');
}

/**
 * Full account-data wipe.
 *
 * Used for: explicit "Sign out and clear data", account-change confirmation
 * during login, and demo entry when leftover real-account data is detected.
 *
 * Clears:
 * - TanStack Query in-memory cache (via passed queryClient)
 * - Persisted query cache in AsyncStorage
 * - Rust engine cache including athlete_profile + sport_settings (engine.clear())
 * - FileSystem GPS tracks, bounds, route names, terrain previews
 * - The insight fingerprint, whose constant ids would otherwise hide the next
 *   athlete's own cards from them
 *
 * Does NOT clear:
 * - AuthStore (caller handles this)
 * - SyncDateRangeStore (caller may want to reset separately)
 */
export async function clearAccountData(queryClient: { clear: () => void }): Promise<void> {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  queryClient.clear();
  await AsyncStorage.removeItem('veloq-query-cache');

  // Rust engine.clear() now wipes athlete_profile + sport_settings as well as
  // all activity / GPS / section tables (see persistence/activities.rs).
  // Note: cannot delete the database file - Rust PERSISTENT_ENGINE global holds
  // the connection and VeloqEngine.create() skips re-init if the global is Some.
  const engine = getEngine();
  if (engine) await engine.clear();

  await Promise.all([
    clearAllGpsTracks(),
    clearBoundsCache(),
    FileSystem.deleteAsync(ROUTE_NAMES_FILE, { idempotent: true }),
    clearTerrainPreviews(),
    forgetCachedAthleteId(),
    forgetStoredActivityCount(),
    forgetInsightFingerprint(),
  ]);

  log.log('Cleared all app caches');
}

/**
 * Demo-mode cleanup.
 *
 * Used for: leaving demo mode via the "Tap to sign in" banner. The engine
 * only ever holds one identity at a time, so when this fires the engine
 * state IS the demo data - a full clearAccountData wipe is correct. The
 * dedicated alias documents intent at the call site and lets us swap in
 * a more selective implementation later if the engine ever supports
 * multi-account state.
 */
export async function clearDemoData(queryClient: { clear: () => void }): Promise<void> {
  await clearAccountData(queryClient);
}
