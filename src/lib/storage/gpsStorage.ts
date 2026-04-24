/**
 * FileSystem-based storage for bounds cache, route names, and database size estimation.
 *
 * GPS track storage functions have been removed — all GPS data is now stored
 * exclusively in the Rust SQLite engine (routes.db gps_tracks table).
 * The clearAllGpsTracks() function is retained for cleanup of any legacy files.
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';
import { debug } from '../utils/debug';
import { safeJsonParseWithSchema, type SchemaValidator } from '../utils/validation';
import { getRouteEngine } from '@/lib/native/routeEngine';

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
// Bounds Cache Storage (FileSystem-based to avoid AsyncStorage limits)
// =============================================================================

const CACHE_DIR = `${FileSystem.documentDirectory}bounds_cache/`;
const BOUNDS_CACHE_FILE = `${CACHE_DIR}bounds.json`;
const OLDEST_DATE_FILE = `${CACHE_DIR}oldest_date.txt`;
const CHECKPOINT_FILE = `${CACHE_DIR}checkpoint.json`;

/** Ensure the cache directory exists */
async function ensureCacheDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    log.log('Created bounds cache directory');
  }
}

/**
 * Store the bounds cache to FileSystem
 */
export async function storeBoundsCache(cache: unknown): Promise<void> {
  await ensureCacheDir();
  const data = JSON.stringify(cache);
  await FileSystem.writeAsStringAsync(BOUNDS_CACHE_FILE, data);
  log.log(`Stored bounds cache: ${Math.round(data.length / 1024)}KB`);
}

/**
 * Load the bounds cache from FileSystem with optional schema validation.
 * @param validator - Optional type guard to validate parsed data
 * @param defaultValue - Value to return if validation fails (defaults to null)
 */
export async function loadBoundsCache<T>(
  validator?: SchemaValidator<T>,
  defaultValue: T | null = null
): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(BOUNDS_CACHE_FILE);
    if (!info.exists) return null;

    const data = await FileSystem.readAsStringAsync(BOUNDS_CACHE_FILE);
    if (validator) {
      return safeJsonParseWithSchema(data, validator, defaultValue as T);
    }
    // Fallback to unvalidated parse for backwards compatibility
    return JSON.parse(data) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Store the oldest activity date
 */
export async function storeOldestDate(date: string): Promise<void> {
  await ensureCacheDir();
  await FileSystem.writeAsStringAsync(OLDEST_DATE_FILE, date);
}

/**
 * Load the oldest activity date
 */
export async function loadOldestDate(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(OLDEST_DATE_FILE);
    if (!info.exists) return null;

    return await FileSystem.readAsStringAsync(OLDEST_DATE_FILE);
  } catch {
    return null;
  }
}

/**
 * Store sync checkpoint
 */
export async function storeCheckpoint(checkpoint: unknown): Promise<void> {
  await ensureCacheDir();
  await FileSystem.writeAsStringAsync(CHECKPOINT_FILE, JSON.stringify(checkpoint));
}

/**
 * Load sync checkpoint with optional schema validation.
 * @param validator - Optional type guard to validate parsed data
 * @param defaultValue - Value to return if validation fails (defaults to null)
 */
export async function loadCheckpoint<T>(
  validator?: SchemaValidator<T>,
  defaultValue: T | null = null
): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(CHECKPOINT_FILE);
    if (!info.exists) return null;

    const data = await FileSystem.readAsStringAsync(CHECKPOINT_FILE);
    if (validator) {
      return safeJsonParseWithSchema(data, validator, defaultValue as T);
    }
    // Fallback to unvalidated parse for backwards compatibility
    return JSON.parse(data) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Clear sync checkpoint
 */
export async function clearCheckpoint(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(CHECKPOINT_FILE);
    if (info.exists) {
      await FileSystem.deleteAsync(CHECKPOINT_FILE, { idempotent: true });
    }
  } catch {
    // Best effort
  }
}

/**
 * Clear the entire bounds cache (but not GPS tracks or oldest date)
 */
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

/**
 * Estimate bounds cache size in bytes
 */
export async function estimateBoundsCacheSize(): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(BOUNDS_CACHE_FILE);
    if (info.exists && 'size' in info) {
      return info.size || 0;
    }
  } catch {
    // Ignore
  }
  return 0;
}

// =============================================================================
// Custom Route Names Storage
// =============================================================================

const ROUTE_NAMES_FILE = `${CACHE_DIR}route_names.json`;

/**
 * Load custom route names
 */
export async function loadCustomRouteNames(): Promise<Record<string, string>> {
  try {
    await ensureCacheDir();
    const info = await FileSystem.getInfoAsync(ROUTE_NAMES_FILE);
    if (!info.exists) return {};

    const data = await FileSystem.readAsStringAsync(ROUTE_NAMES_FILE);
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Save a custom route name
 */
export async function saveCustomRouteName(routeId: string, name: string): Promise<void> {
  await ensureCacheDir();
  const names = await loadCustomRouteNames();
  names[routeId] = name;
  await FileSystem.writeAsStringAsync(ROUTE_NAMES_FILE, JSON.stringify(names));
}

/**
 * Get display name for a route (custom name or generated)
 */
export function getRouteDisplayName(
  route: { id: string; name?: string },
  customNames: Record<string, string>
): string {
  return customNames[route.id] || route.name || 'Unnamed Route';
}

// =============================================================================
// Routes Database Size (Rust SQLite)
// =============================================================================

const ROUTES_DB_PATH = `${FileSystem.documentDirectory}routes.db`;

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
  const [main, wal, shm] = await Promise.all([
    getFileSize(ROUTES_DB_PATH),
    getFileSize(`${ROUTES_DB_PATH}-wal`),
    getFileSize(`${ROUTES_DB_PATH}-shm`),
  ]);
  return main + wal + shm;
}

/**
 * Recursively measure total size of a directory in bytes.
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(dirPath);
    if (!dirInfo.exists || !dirInfo.isDirectory) return 0;

    const entries = await FileSystem.readDirectoryAsync(dirPath);
    let total = 0;

    for (const entry of entries) {
      const fullPath = `${dirPath}${entry}`;
      const info = await FileSystem.getInfoAsync(fullPath);
      if (!info.exists) continue;
      if (info.isDirectory) {
        total += await getDirectorySize(`${fullPath}/`);
      } else if ('size' in info) {
        total += info.size || 0;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Get total app storage usage across documentDirectory and cacheDirectory.
 * This is the ground-truth measurement that accounts for all files the app
 * has written, including SQLite WAL files, map caches, terrain previews, etc.
 */
export async function getAppStorageSize(): Promise<number> {
  const docDir = FileSystem.documentDirectory;
  const cacheDir = FileSystem.cacheDirectory;

  const [docSize, cacheSize] = await Promise.all([
    docDir ? getDirectorySize(docDir) : Promise.resolve(0),
    cacheDir ? getDirectorySize(cacheDir) : Promise.resolve(0),
  ]);

  return docSize + cacheSize;
}

// =============================================================================
// Comprehensive Cache Clearing (for auth transitions)
// =============================================================================

/**
 * Clear all app caches comprehensively.
 * Should be called when transitioning between auth states (login/logout/demo).
 *
 * Clears:
 * - TanStack Query in-memory cache (via passed queryClient)
 * - Persisted query cache in AsyncStorage
 * - Rust engine cache (SQLite)
 * - FileSystem GPS tracks and bounds caches
 *
 * Does NOT clear:
 * - AuthStore (caller handles this)
 * - SyncDateRangeStore (caller may want to reset separately)
 */
export async function clearAllAppCaches(queryClient: { clear: () => void }): Promise<void> {
  // Import AsyncStorage here to keep this module focused on FileSystem
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  // 1. Clear TanStack Query in-memory cache
  queryClient.clear();

  // 2. Clear persisted query cache in AsyncStorage (critical!)
  await AsyncStorage.removeItem('veloq-query-cache');

  // 3. Clear Rust engine cache (deletes all rows from SQLite tables)
  // Note: cannot delete the database file — Rust PERSISTENT_ENGINE global holds
  // the connection and VeloqEngine.create() skips re-init if the global is Some.
  const routeEngine = getRouteEngine();
  if (routeEngine) routeEngine.clear();

  // 4. Clear FileSystem caches (legacy GPS tracks, bounds, and route names)
  await Promise.all([
    clearAllGpsTracks(),
    clearBoundsCache(),
    FileSystem.deleteAsync(ROUTE_NAMES_FILE, { idempotent: true }),
  ]);

  log.log('Cleared all app caches');
}
