/**
 * Filesystem-based JPEG cache for 3D terrain preview images.
 *
 * Stores pre-rendered 3D terrain map snapshots as JPEG files with a hard cap
 * on the number of cached images. Uses an in-memory index for fast lookups
 * without filesystem calls.
 *
 * Cache keys are compound: `{activityId}_{style}` so switching map styles
 * doesn't serve stale images.
 *
 * Storage location: cacheDirectory/terrain_previews/
 */

// Use legacy API for SDK 54 compatibility
import * as FileSystem from 'expo-file-system/legacy';

const TERRAIN_DIR = `${FileSystem.cacheDirectory}terrain_previews/`;
const MAX_CACHED_PREVIEWS = 50;

/** Compound cache key */
function cacheKey(activityId: string, style: string): string {
  return `${activityId}_${style}`;
}

/** In-memory index of cached compound keys (ordered by insertion) */
let cachedKeys: string[] = [];
let initialized = false;

/**
 * Load index from disk on app start.
 * Scans the directory for existing JPEG files and populates the in-memory index.
 */
export async function initTerrainPreviewCache(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(TERRAIN_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(TERRAIN_DIR, { intermediates: true });
      cachedKeys = [];
      initialized = true;
      return;
    }

    const files = await FileSystem.readDirectoryAsync(TERRAIN_DIR);
    cachedKeys = files.filter((f) => f.endsWith('.jpg')).map((f) => f.replace('.jpg', ''));
    initialized = true;
  } catch {
    cachedKeys = [];
    initialized = true;
  }
}

/** Ensure directory exists */
async function ensureDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(TERRAIN_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(TERRAIN_DIR, { intermediates: true });
  }
}

/**
 * Check if a preview exists for the given activity and style (sync via in-memory index).
 */
export function hasTerrainPreview(activityId: string, style: string): boolean {
  return cachedKeys.includes(cacheKey(activityId, style));
}

/**
 * Get cached preview URI (file:// path).
 */
export function getTerrainPreviewUri(activityId: string, style: string): string {
  return `${TERRAIN_DIR}${cacheKey(activityId, style)}.jpg`;
}

/**
 * Save preview from base64 data. Evicts oldest if over cap.
 * Returns the file URI of the saved image.
 */
export async function saveTerrainPreview(
  activityId: string,
  style: string,
  base64: string
): Promise<string> {
  await ensureDir();

  const key = cacheKey(activityId, style);

  // Evict oldest if at cap (and the key to save isn't already cached)
  if (!cachedKeys.includes(key) && cachedKeys.length >= MAX_CACHED_PREVIEWS) {
    const evictKey = cachedKeys.shift();
    if (evictKey) {
      const evictPath = `${TERRAIN_DIR}${evictKey}.jpg`;
      await FileSystem.deleteAsync(evictPath, { idempotent: true }).catch(() => {});
    }
  }

  const filePath = `${TERRAIN_DIR}${key}.jpg`;
  await FileSystem.writeAsStringAsync(filePath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Update index - remove if already present, add to end
  cachedKeys = cachedKeys.filter((k) => k !== key);
  cachedKeys.push(key);

  return filePath;
}

/**
 * Delete all cached snapshots for a specific activity (all styles).
 * Used when camera override changes to force regeneration.
 */
export async function deleteTerrainPreviewsForActivity(activityId: string): Promise<void> {
  const prefix = `${activityId}_`;
  const toDelete = cachedKeys.filter((k) => k.startsWith(prefix));

  for (const key of toDelete) {
    const path = `${TERRAIN_DIR}${key}.jpg`;
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }

  cachedKeys = cachedKeys.filter((k) => !k.startsWith(prefix));
}

/**
 * Garbage collect: given the current ordered list of feed activity IDs,
 * delete any cached images not matching those activities.
 */
export async function gcTerrainPreviews(visibleActivityIds: string[]): Promise<void> {
  const keepSet = new Set(visibleActivityIds.slice(0, MAX_CACHED_PREVIEWS));
  // Keep any key whose activityId portion matches a visible activity
  const toEvict = cachedKeys.filter((key) => {
    const activityId = key.substring(0, key.lastIndexOf('_'));
    return !keepSet.has(activityId);
  });

  for (const key of toEvict) {
    const path = `${TERRAIN_DIR}${key}.jpg`;
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }

  cachedKeys = cachedKeys.filter((key) => !toEvict.includes(key));
}

/**
 * Clear all terrain preview images.
 */
export async function clearTerrainPreviews(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(TERRAIN_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(TERRAIN_DIR, { idempotent: true });
    }
  } catch {
    // Best effort cleanup
  }
  cachedKeys = [];
}

/**
 * Get total cache size in bytes.
 */
export async function getTerrainPreviewCacheSize(): Promise<number> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(TERRAIN_DIR);
    if (!dirInfo.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(TERRAIN_DIR);
    const jpgFiles = files.filter((f) => f.endsWith('.jpg'));
    if (jpgFiles.length === 0) return 0;

    let totalSize = 0;
    for (const file of jpgFiles) {
      const info = await FileSystem.getInfoAsync(`${TERRAIN_DIR}${file}`);
      if (info.exists && 'size' in info) {
        totalSize += info.size || 0;
      }
    }
    return totalSize;
  } catch {
    return 0;
  }
}

/**
 * Get count of cached previews.
 */
export function getTerrainPreviewCount(): number {
  return cachedKeys.length;
}
