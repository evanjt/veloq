/**
 * Separate storage for GPS tracks using FileSystem.
 *
 * The main bounds cache stores metadata only (small, loads fast).
 * GPS tracks are stored as individual JSON files (can be large, loaded on demand).
 *
 * Uses Expo FileSystem instead of AsyncStorage to avoid:
 * - Android's 6MB SQLite database limit
 * - 2MB CursorWindow limit
 *
 * Storage location: documentDirectory/gps_tracks/
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';
import { debug } from '../utils/debug';
import { safeJsonParseWithSchema, type SchemaValidator } from '../utils/validation';

/**
 * Type guard for GPS track data - array of [lat, lng] tuples
 */
function isGpsTrack(value: unknown): value is [number, number][] {
  if (!Array.isArray(value)) return false;
  // Check first few elements for performance (don't validate entire array)
  const samplesToCheck = Math.min(value.length, 5);
  for (let i = 0; i < samplesToCheck; i++) {
    const coord = value[i];
    if (!Array.isArray(coord) || coord.length !== 2) return false;
    if (typeof coord[0] !== 'number' || typeof coord[1] !== 'number') return false;
  }
  return true;
}

/**
 * Type guard for GPS index structure
 */
function isGpsIndex(value: unknown): value is GpsIndex {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.activityIds)) return false;
  if (typeof obj.lastUpdated !== 'string') return false;
  // Validate all elements are strings (empty array is valid and returns true)
  if (!obj.activityIds.every((id) => typeof id === 'string')) return false;
  return true;
}

const log = debug.create('GpsStorage');

const GPS_DIR = `${FileSystem.documentDirectory}gps_tracks/`;
const GPS_INDEX_FILE = `${GPS_DIR}index.json`;

/** Get the storage path for an activity's GPS track */
function getGpsPath(activityId: string): string {
  // Sanitize activity ID for filename
  const safeId = activityId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${GPS_DIR}${safeId}.json`;
}

/** Index of stored GPS tracks (for bulk operations) */
interface GpsIndex {
  activityIds: string[];
  lastUpdated: string;
}

/** Ensure the GPS directory exists */
async function ensureGpsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(GPS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(GPS_DIR, { intermediates: true });
    log.log('Created GPS tracks directory');
  }
}

/**
 * Store GPS track for an activity
 */
export async function storeGpsTrack(
  activityId: string,
  latlngs: [number, number][]
): Promise<void> {
  await ensureGpsDir();
  const path = getGpsPath(activityId);
  await FileSystem.writeAsStringAsync(path, JSON.stringify(latlngs));
}

/**
 * Store multiple GPS tracks efficiently
 */
export async function storeGpsTracks(tracks: Map<string, [number, number][]>): Promise<void> {
  if (tracks.size === 0) return;

  await ensureGpsDir();

  let totalBytes = 0;
  const trackEntries: { activityId: string; path: string; data: string }[] = [];

  // Prepare all tracks for writing
  for (const [activityId, latlngs] of tracks) {
    const data = JSON.stringify(latlngs);
    totalBytes += data.length;
    trackEntries.push({
      activityId,
      path: getGpsPath(activityId),
      data,
    });
  }

  log.log(`Storing ${tracks.size} GPS tracks, total ${Math.round(totalBytes / 1024)}KB`);

  // Write all files in parallel, using allSettled to handle individual failures
  const results = await Promise.allSettled(
    trackEntries.map((entry) =>
      FileSystem.writeAsStringAsync(entry.path, entry.data).then(() => entry.activityId)
    )
  );

  // Collect successfully written activity IDs
  const successfulIds: string[] = [];
  let failedCount = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      successfulIds.push(result.value);
    } else {
      failedCount++;
    }
  }

  if (failedCount > 0) {
    log.log(`Warning: ${failedCount} GPS track writes failed`);
  }

  // Update index with only the successfully written tracks
  if (successfulIds.length > 0) {
    await updateGpsIndex(successfulIds);
  }

  log.log(`Successfully stored ${successfulIds.length} GPS tracks`);
}

/**
 * Get GPS track for an activity
 */
export async function getGpsTrack(activityId: string): Promise<[number, number][] | null> {
  const path = getGpsPath(activityId);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;

  try {
    const data = await FileSystem.readAsStringAsync(path);
    const parsed = safeJsonParseWithSchema(data, isGpsTrack, null as unknown as [number, number][]);
    return parsed;
  } catch {
    log.log(`Failed to parse GPS track for ${activityId}`);
    return null;
  }
}

/**
 * Get multiple GPS tracks efficiently
 */
export async function getGpsTracks(
  activityIds: string[]
): Promise<Map<string, [number, number][]>> {
  if (activityIds.length === 0) return new Map();

  const results = new Map<string, [number, number][]>();

  // Read all files in parallel
  const promises = activityIds.map(async (activityId) => {
    try {
      const track = await getGpsTrack(activityId);
      if (track) {
        results.set(activityId, track);
      }
    } catch {
      // Skip individual failures
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Check if GPS track exists for an activity
 */
export async function hasGpsTrack(activityId: string): Promise<boolean> {
  const path = getGpsPath(activityId);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists;
}

/**
 * Update the GPS index with new activity IDs
 */
async function updateGpsIndex(newActivityIds: string[]): Promise<void> {
  try {
    await ensureGpsDir();

    const defaultIndex: GpsIndex = { activityIds: [], lastUpdated: '' };
    let index: GpsIndex = defaultIndex;

    const indexInfo = await FileSystem.getInfoAsync(GPS_INDEX_FILE);
    if (indexInfo.exists) {
      const indexStr = await FileSystem.readAsStringAsync(GPS_INDEX_FILE);
      index = safeJsonParseWithSchema(indexStr, isGpsIndex, defaultIndex);
    }

    // Add new IDs (avoid duplicates)
    const existingSet = new Set(index.activityIds);
    for (const id of newActivityIds) {
      existingSet.add(id);
    }

    index.activityIds = Array.from(existingSet);
    index.lastUpdated = new Date().toISOString();

    await FileSystem.writeAsStringAsync(GPS_INDEX_FILE, JSON.stringify(index));
  } catch {
    // Index is optional, don't fail on error
  }
}

/**
 * Clear all GPS tracks
 */
export async function clearAllGpsTracks(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(GPS_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(GPS_DIR, { idempotent: true });
      log.log('Cleared all GPS tracks');
    }
  } catch {
    // Best effort cleanup
  }
}

/**
 * Get all cached activity IDs from the GPS index
 */
export async function getCachedActivityIds(): Promise<string[]> {
  try {
    const indexInfo = await FileSystem.getInfoAsync(GPS_INDEX_FILE);
    if (indexInfo.exists) {
      const indexStr = await FileSystem.readAsStringAsync(GPS_INDEX_FILE);
      const defaultIndex: GpsIndex = { activityIds: [], lastUpdated: '' };
      const index = safeJsonParseWithSchema(indexStr, isGpsIndex, defaultIndex);
      return index.activityIds;
    }
  } catch {
    // Best effort - return empty array on error
  }
  return [];
}

/**
 * Get count of stored GPS tracks
 */
export async function getGpsTrackCount(): Promise<number> {
  try {
    const indexInfo = await FileSystem.getInfoAsync(GPS_INDEX_FILE);
    if (indexInfo.exists) {
      const indexStr = await FileSystem.readAsStringAsync(GPS_INDEX_FILE);
      const defaultIndex: GpsIndex = { activityIds: [], lastUpdated: '' };
      const index = safeJsonParseWithSchema(indexStr, isGpsIndex, defaultIndex);
      return index.activityIds.length;
    }
  } catch {
    // Fall through to directory scan
  }

  // Fallback: count files in directory
  try {
    const dirInfo = await FileSystem.getInfoAsync(GPS_DIR);
    if (dirInfo.exists) {
      const files = await FileSystem.readDirectoryAsync(GPS_DIR);
      // Count only .json files, excluding index
      return files.filter((f) => f.endsWith('.json') && f !== 'index.json').length;
    }
  } catch {
    // Ignore
  }

  return 0;
}

/**
 * Estimate total GPS storage size in bytes
 */
export async function estimateGpsStorageSize(): Promise<number> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(GPS_DIR);
    if (!dirInfo.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(GPS_DIR);
    const gpsFiles = files.filter((f) => f.endsWith('.json') && f !== 'index.json');

    if (gpsFiles.length === 0) return 0;

    // Sample a few to estimate average size
    const sampleSize = Math.min(5, gpsFiles.length);
    let totalSampleSize = 0;

    for (let i = 0; i < sampleSize; i++) {
      const fileInfo = await FileSystem.getInfoAsync(`${GPS_DIR}${gpsFiles[i]}`);
      if (fileInfo.exists && 'size' in fileInfo) {
        totalSampleSize += fileInfo.size || 0;
      }
    }

    const avgSize = totalSampleSize / sampleSize;
    return Math.round(avgSize * gpsFiles.length);
  } catch {
    return 0;
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
    return JSON.parse(data);
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
