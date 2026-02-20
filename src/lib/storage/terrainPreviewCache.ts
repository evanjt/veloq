/**
 * Filesystem-based JPEG cache for 3D terrain preview images.
 *
 * Stores pre-rendered 3D terrain map snapshots as JPEG files with a hard cap
 * on the number of cached images. Uses an in-memory index for fast lookups
 * without filesystem calls.
 *
 * Storage location: cacheDirectory/terrain_previews/
 */

// Use legacy API for SDK 54 compatibility
import * as FileSystem from 'expo-file-system/legacy';

const TERRAIN_DIR = `${FileSystem.cacheDirectory}terrain_previews/`;
const MAX_CACHED_PREVIEWS = 10;

/** In-memory index of cached activity IDs (ordered by insertion) */
let cachedIds: string[] = [];
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
      cachedIds = [];
      initialized = true;
      return;
    }

    const files = await FileSystem.readDirectoryAsync(TERRAIN_DIR);
    cachedIds = files.filter((f) => f.endsWith('.jpg')).map((f) => f.replace('.jpg', ''));
    initialized = true;
  } catch {
    cachedIds = [];
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
 * Check if a preview exists (sync via in-memory index).
 */
export function hasTerrainPreview(activityId: string): boolean {
  return cachedIds.includes(activityId);
}

/**
 * Get cached preview URI (file:// path).
 */
export function getTerrainPreviewUri(activityId: string): string {
  return `${TERRAIN_DIR}${activityId}.jpg`;
}

/**
 * Save preview from base64 data. Evicts oldest if over cap.
 * Returns the file URI of the saved image.
 */
export async function saveTerrainPreview(activityId: string, base64: string): Promise<string> {
  await ensureDir();

  // Evict oldest if at cap (and the activity to save isn't already cached)
  if (!cachedIds.includes(activityId) && cachedIds.length >= MAX_CACHED_PREVIEWS) {
    const evictId = cachedIds.shift();
    if (evictId) {
      const evictPath = `${TERRAIN_DIR}${evictId}.jpg`;
      await FileSystem.deleteAsync(evictPath, { idempotent: true }).catch(() => {});
    }
  }

  const filePath = `${TERRAIN_DIR}${activityId}.jpg`;
  await FileSystem.writeAsStringAsync(filePath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Update index - remove if already present, add to end
  cachedIds = cachedIds.filter((id) => id !== activityId);
  cachedIds.push(activityId);

  return filePath;
}

/**
 * Garbage collect: given the current ordered list of feed activity IDs,
 * delete any cached images not in the top N.
 */
export async function gcTerrainPreviews(visibleActivityIds: string[]): Promise<void> {
  const keepSet = new Set(visibleActivityIds.slice(0, MAX_CACHED_PREVIEWS));
  const toEvict = cachedIds.filter((id) => !keepSet.has(id));

  for (const id of toEvict) {
    const path = `${TERRAIN_DIR}${id}.jpg`;
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }

  cachedIds = cachedIds.filter((id) => keepSet.has(id));
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
  cachedIds = [];
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
  return cachedIds.length;
}
