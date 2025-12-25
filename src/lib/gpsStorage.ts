/**
 * Separate storage for GPS tracks to avoid AsyncStorage size limits.
 *
 * The main bounds cache stores metadata only (small, loads fast).
 * GPS tracks are stored in individual keys per activity (can be large, loaded on demand).
 *
 * This avoids Android's 2MB CursorWindow limit which was causing crashes
 * when storing full GPS tracks in the main cache.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const GPS_KEY_PREFIX = 'gps_track_';
const GPS_INDEX_KEY = 'gps_track_index';

/** Get the storage key for an activity's GPS track */
function getGpsKey(activityId: string): string {
  return `${GPS_KEY_PREFIX}${activityId}`;
}

/** Index of stored GPS tracks (for bulk operations) */
interface GpsIndex {
  activityIds: string[];
  lastUpdated: string;
}

/**
 * Store GPS track for an activity
 */
export async function storeGpsTrack(
  activityId: string,
  latlngs: [number, number][]
): Promise<void> {
  const key = getGpsKey(activityId);
  await AsyncStorage.setItem(key, JSON.stringify(latlngs));
}

/**
 * Store multiple GPS tracks efficiently
 */
export async function storeGpsTracks(
  tracks: Map<string, [number, number][]>
): Promise<void> {
  if (tracks.size === 0) return;

  const pairs: [string, string][] = [];
  let totalBytes = 0;
  for (const [activityId, latlngs] of tracks) {
    const data = JSON.stringify(latlngs);
    totalBytes += data.length;
    pairs.push([getGpsKey(activityId), data]);
  }

  console.log(`[GpsStorage] Storing ${tracks.size} GPS tracks, total ${Math.round(totalBytes / 1024)}KB`);

  // Store in batches to avoid memory issues
  const BATCH_SIZE = 20;
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);
    try {
      await AsyncStorage.multiSet(batch);
    } catch (error) {
      console.error(`[GpsStorage] Failed to store batch ${i / BATCH_SIZE + 1}:`, error);
      throw error;
    }
  }

  // Update index
  await updateGpsIndex(Array.from(tracks.keys()));
}

/**
 * Get GPS track for an activity
 */
export async function getGpsTrack(
  activityId: string
): Promise<[number, number][] | null> {
  const key = getGpsKey(activityId);
  const data = await AsyncStorage.getItem(key);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * Get multiple GPS tracks efficiently
 */
export async function getGpsTracks(
  activityIds: string[]
): Promise<Map<string, [number, number][]>> {
  if (activityIds.length === 0) return new Map();

  const keys = activityIds.map(getGpsKey);
  const results = new Map<string, [number, number][]>();

  // Fetch in batches to avoid memory issues
  const BATCH_SIZE = 20;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batchKeys = keys.slice(i, i + BATCH_SIZE);
    const batchIds = activityIds.slice(i, i + BATCH_SIZE);

    const pairs = await AsyncStorage.multiGet(batchKeys);
    for (let j = 0; j < pairs.length; j++) {
      const [, value] = pairs[j];
      if (value) {
        results.set(batchIds[j], JSON.parse(value));
      }
    }
  }

  return results;
}

/**
 * Check if GPS track exists for an activity
 */
export async function hasGpsTrack(activityId: string): Promise<boolean> {
  const key = getGpsKey(activityId);
  const data = await AsyncStorage.getItem(key);
  return data !== null;
}

/**
 * Update the GPS index with new activity IDs
 */
async function updateGpsIndex(newActivityIds: string[]): Promise<void> {
  try {
    const indexStr = await AsyncStorage.getItem(GPS_INDEX_KEY);
    const index: GpsIndex = indexStr
      ? JSON.parse(indexStr)
      : { activityIds: [], lastUpdated: '' };

    // Add new IDs (avoid duplicates)
    const existingSet = new Set(index.activityIds);
    for (const id of newActivityIds) {
      existingSet.add(id);
    }

    index.activityIds = Array.from(existingSet);
    index.lastUpdated = new Date().toISOString();

    await AsyncStorage.setItem(GPS_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Index is optional, don't fail on error
  }
}

/**
 * Clear all GPS tracks
 */
export async function clearAllGpsTracks(): Promise<void> {
  try {
    const indexStr = await AsyncStorage.getItem(GPS_INDEX_KEY);
    if (indexStr) {
      const index: GpsIndex = JSON.parse(indexStr);
      const keys = index.activityIds.map(getGpsKey);
      if (keys.length > 0) {
        await AsyncStorage.multiRemove(keys);
      }
    }
    await AsyncStorage.removeItem(GPS_INDEX_KEY);
  } catch {
    // Best effort cleanup
  }
}

/**
 * Get count of stored GPS tracks
 */
export async function getGpsTrackCount(): Promise<number> {
  try {
    const indexStr = await AsyncStorage.getItem(GPS_INDEX_KEY);
    if (indexStr) {
      const index: GpsIndex = JSON.parse(indexStr);
      return index.activityIds.length;
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
    const allKeys = await AsyncStorage.getAllKeys();
    const gpsKeys = allKeys.filter(k => k.startsWith(GPS_KEY_PREFIX));
    if (gpsKeys.length === 0) return 0;

    // Sample a few to estimate average size
    const sampleSize = Math.min(5, gpsKeys.length);
    const sampleKeys = gpsKeys.slice(0, sampleSize);
    const samples = await AsyncStorage.multiGet(sampleKeys);

    let totalSampleSize = 0;
    for (const [, value] of samples) {
      if (value) totalSampleSize += value.length;
    }
    const avgSize = totalSampleSize / sampleSize;

    return Math.round(avgSize * gpsKeys.length);
  } catch {
    return 0;
  }
}
