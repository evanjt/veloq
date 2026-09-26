/**
 * Where the terrain previews live, and where they used to.
 *
 * Here rather than in the maps feature because launch needs the path too, to ask
 * for the backup exclusion and to clear the old root, and launch importing the
 * maps barrel pulls that feature's whole closure into the launch path: the
 * barrel reaches the map surface, which reaches the support card, which reaches
 * the in-app purchase module. A shared module is the split the layering rule
 * asks for.
 */
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Beside the tile tree, not in the cache directory.
 *
 * Both platforms may purge `cacheDirectory` while the app is backgrounded, and
 * the feed then mounts with 150 misses and redraws every snapshot through the
 * WebView, which is the most expensive thing the app draws, on the path that has
 * to be fast. The 150-entry cap and the least-recently-served eviction are what
 * bound it instead, and launch asks for the same backup exclusion the tile tree
 * gets, since a cache that can be redrawn has no business in the athlete's
 * backup.
 */
export const TERRAIN_PREVIEW_DIR = `${FileSystem.documentDirectory}terrain_previews/`;

/** Where they lived until 2026-09-13, so one launch can clear what it still holds. */
export const LEGACY_TERRAIN_PREVIEW_DIR = `${FileSystem.cacheDirectory}terrain_previews/`;

/**
 * Delete the previews left in the cache directory by a build before the move.
 *
 * They are deleted rather than moved: every one redraws, and copying up to 150
 * JPEGs on the launch path costs more than the misses do. Idempotent and best
 * effort, so a device that never held them, or has had the directory purged
 * already, does nothing.
 */
export async function discardLegacyTerrainPreviews(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(LEGACY_TERRAIN_PREVIEW_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(LEGACY_TERRAIN_PREVIEW_DIR, { idempotent: true });
    }
  } catch {
    // The old root is a cache the OS may already have taken. Nothing here is
    // worth failing a launch for.
  }
}
