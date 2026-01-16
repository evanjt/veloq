/**
 * Storage for activity streams using FileSystem.
 *
 * Stores activity streams (HR, power, cadence, altitude, etc.) as individual JSON files.
 * Similar to gpsStorage.ts but for time-series performance data.
 *
 * Storage location: documentDirectory/activity_streams/
 *
 * Note: This is a TypeScript-based implementation that can be migrated to
 * Rust storage (via tracematch crate) in the future for unified caching.
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';
import { debug } from '../utils/debug';
import { safeJsonParseWithSchema } from '../utils/validation';
import type { ActivityStreams, RawStreamItem } from '@/types';

const log = debug.create('StreamStorage');

const STREAMS_DIR = `${FileSystem.documentDirectory}activity_streams/`;
const STREAMS_INDEX_FILE = `${STREAMS_DIR}index.json`;

/** Get the storage path for an activity's streams */
function getStreamsPath(activityId: string): string {
  // Sanitize activity ID for filename
  const safeId = activityId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${STREAMS_DIR}${safeId}.json`;
}

/** Index of stored streams (for bulk operations) */
interface StreamsIndex {
  activityIds: string[];
  lastUpdated: string;
}

/**
 * Type guard for streams index structure
 */
function isStreamsIndex(value: unknown): value is StreamsIndex {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.activityIds)) return false;
  if (typeof obj.lastUpdated !== 'string') return false;
  if (!obj.activityIds.every((id) => typeof id === 'string')) return false;
  return true;
}

/**
 * Type guard for ActivityStreams structure
 */
function isActivityStreams(value: unknown): value is ActivityStreams {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  // Check optional properties are arrays of numbers if present
  const numArrayProps = [
    'time',
    'heartrate',
    'watts',
    'cadence',
    'altitude',
    'velocity_smooth',
    'distance',
  ];
  for (const prop of numArrayProps) {
    if (prop in obj && obj[prop] !== undefined) {
      if (!Array.isArray(obj[prop])) return false;
      // Sample check first few elements
      const arr = obj[prop] as unknown[];
      const samplesToCheck = Math.min(arr.length, 3);
      for (let i = 0; i < samplesToCheck; i++) {
        if (typeof arr[i] !== 'number') return false;
      }
    }
  }
  // Check latlng is array of tuples if present
  if ('latlng' in obj && obj.latlng !== undefined) {
    if (!Array.isArray(obj.latlng)) return false;
  }
  return true;
}

/** Ensure the streams directory exists */
async function ensureStreamsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(STREAMS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(STREAMS_DIR, { intermediates: true });
    log.log('Created activity streams directory');
  }
}

/**
 * Store activity streams
 */
export async function storeActivityStreams(
  activityId: string,
  streams: ActivityStreams
): Promise<void> {
  await ensureStreamsDir();
  const path = getStreamsPath(activityId);
  await FileSystem.writeAsStringAsync(path, JSON.stringify(streams));
  await updateStreamsIndex([activityId]);
}

/**
 * Store multiple activity streams efficiently
 */
export async function storeMultipleActivityStreams(
  streamsMap: Map<string, ActivityStreams>
): Promise<void> {
  if (streamsMap.size === 0) return;

  await ensureStreamsDir();

  let totalBytes = 0;
  const entries: { activityId: string; path: string; data: string }[] = [];

  // Prepare all streams for writing
  for (const [activityId, streams] of streamsMap) {
    const data = JSON.stringify(streams);
    totalBytes += data.length;
    entries.push({
      activityId,
      path: getStreamsPath(activityId),
      data,
    });
  }

  log.log(`Storing ${streamsMap.size} activity streams, total ${Math.round(totalBytes / 1024)}KB`);

  // Write all files in parallel, using allSettled to handle individual failures
  const results = await Promise.allSettled(
    entries.map((entry) =>
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
    log.log(`Warning: ${failedCount} stream writes failed`);
  }

  // Update index with only the successfully written streams
  if (successfulIds.length > 0) {
    await updateStreamsIndex(successfulIds);
  }

  log.log(`Successfully stored ${successfulIds.length} activity streams`);
}

/**
 * Get activity streams
 */
export async function getActivityStreams(activityId: string): Promise<ActivityStreams | null> {
  const path = getStreamsPath(activityId);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;

  try {
    const data = await FileSystem.readAsStringAsync(path);
    const parsed = safeJsonParseWithSchema(
      data,
      isActivityStreams,
      null as unknown as ActivityStreams
    );
    return parsed;
  } catch {
    log.log(`Failed to parse streams for ${activityId}`);
    return null;
  }
}

/**
 * Get multiple activity streams efficiently
 */
export async function getMultipleActivityStreams(
  activityIds: string[]
): Promise<Map<string, ActivityStreams>> {
  if (activityIds.length === 0) return new Map();

  const results = new Map<string, ActivityStreams>();

  // Read all files in parallel
  const promises = activityIds.map(async (activityId) => {
    try {
      const streams = await getActivityStreams(activityId);
      if (streams) {
        results.set(activityId, streams);
      }
    } catch {
      // Skip individual failures
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Check if streams exist for an activity
 */
export async function hasActivityStreams(activityId: string): Promise<boolean> {
  const path = getStreamsPath(activityId);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists;
}

/**
 * Update the streams index with new activity IDs
 */
async function updateStreamsIndex(newActivityIds: string[]): Promise<void> {
  try {
    await ensureStreamsDir();

    const defaultIndex: StreamsIndex = { activityIds: [], lastUpdated: '' };
    let index: StreamsIndex = defaultIndex;

    const indexInfo = await FileSystem.getInfoAsync(STREAMS_INDEX_FILE);
    if (indexInfo.exists) {
      const indexStr = await FileSystem.readAsStringAsync(STREAMS_INDEX_FILE);
      index = safeJsonParseWithSchema(indexStr, isStreamsIndex, defaultIndex);
    }

    // Add new IDs (avoid duplicates)
    const existingSet = new Set(index.activityIds);
    for (const id of newActivityIds) {
      existingSet.add(id);
    }

    index.activityIds = Array.from(existingSet);
    index.lastUpdated = new Date().toISOString();

    await FileSystem.writeAsStringAsync(STREAMS_INDEX_FILE, JSON.stringify(index));
  } catch {
    // Index is optional, don't fail on error
  }
}

/**
 * Get all cached stream activity IDs from the index
 */
export async function getCachedStreamActivityIds(): Promise<string[]> {
  try {
    const indexInfo = await FileSystem.getInfoAsync(STREAMS_INDEX_FILE);
    if (indexInfo.exists) {
      const indexStr = await FileSystem.readAsStringAsync(STREAMS_INDEX_FILE);
      const defaultIndex: StreamsIndex = { activityIds: [], lastUpdated: '' };
      const index = safeJsonParseWithSchema(indexStr, isStreamsIndex, defaultIndex);
      return index.activityIds;
    }
  } catch {
    // Best effort - return empty array on error
  }
  return [];
}

/**
 * Clear all stored streams
 */
export async function clearAllActivityStreams(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(STREAMS_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(STREAMS_DIR, { idempotent: true });
      log.log('Cleared all activity streams');
    }
  } catch {
    // Best effort cleanup
  }
}

/**
 * Get count of stored activity streams
 */
export async function getActivityStreamCount(): Promise<number> {
  try {
    const indexInfo = await FileSystem.getInfoAsync(STREAMS_INDEX_FILE);
    if (indexInfo.exists) {
      const indexStr = await FileSystem.readAsStringAsync(STREAMS_INDEX_FILE);
      const defaultIndex: StreamsIndex = { activityIds: [], lastUpdated: '' };
      const index = safeJsonParseWithSchema(indexStr, isStreamsIndex, defaultIndex);
      return index.activityIds.length;
    }
  } catch {
    // Fall through to directory scan
  }

  // Fallback: count files in directory
  try {
    const dirInfo = await FileSystem.getInfoAsync(STREAMS_DIR);
    if (dirInfo.exists) {
      const files = await FileSystem.readDirectoryAsync(STREAMS_DIR);
      // Count only .json files, excluding index
      return files.filter((f) => f.endsWith('.json') && f !== 'index.json').length;
    }
  } catch {
    // Ignore
  }

  return 0;
}

/**
 * Estimate total streams storage size in bytes
 */
export async function estimateStreamsStorageSize(): Promise<number> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(STREAMS_DIR);
    if (!dirInfo.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(STREAMS_DIR);
    const streamFiles = files.filter((f) => f.endsWith('.json') && f !== 'index.json');

    if (streamFiles.length === 0) return 0;

    // Sample a few to estimate average size
    const sampleSize = Math.min(5, streamFiles.length);
    let totalSampleSize = 0;

    for (let i = 0; i < sampleSize; i++) {
      const fileInfo = await FileSystem.getInfoAsync(`${STREAMS_DIR}${streamFiles[i]}`);
      if (fileInfo.exists && 'size' in fileInfo) {
        totalSampleSize += fileInfo.size || 0;
      }
    }

    const avgSize = totalSampleSize / sampleSize;
    return Math.round(avgSize * streamFiles.length);
  } catch {
    return 0;
  }
}

/**
 * Parse raw API streams into ActivityStreams format.
 * This is a utility function to parse streams before storing.
 * (Copied from src/lib/utils/streams.ts for encapsulation)
 */
export function parseRawStreams(rawStreams: RawStreamItem[]): ActivityStreams {
  const streams: ActivityStreams = {};

  for (const stream of rawStreams) {
    switch (stream.type) {
      case 'latlng':
        // latlng uses data for lat, data2 for lng - combine into [lat, lng] tuples
        if (stream.data && stream.data2) {
          streams.latlng = stream.data.map((lat, i) => [lat, stream.data2![i]]);
        }
        break;
      case 'time':
        streams.time = stream.data;
        break;
      case 'altitude':
      case 'fixed_altitude':
        // Use fixed_altitude if available (corrected elevation), fallback to altitude
        if (!streams.altitude || stream.type === 'fixed_altitude') {
          streams.altitude = stream.data;
        }
        break;
      case 'heartrate':
        streams.heartrate = stream.data;
        break;
      case 'watts':
        streams.watts = stream.data;
        break;
      case 'cadence':
        streams.cadence = stream.data;
        break;
      case 'velocity_smooth':
        streams.velocity_smooth = stream.data;
        break;
      case 'distance':
        streams.distance = stream.data;
        break;
    }
  }

  return streams;
}
