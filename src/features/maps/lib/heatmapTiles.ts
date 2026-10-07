/**
 * The heatmap tile cache directory, the template the WebView surfaces read it
 * through, and its size.
 *
 * Tile generation is handled entirely in Rust on a background thread, which
 * starts a pass whenever a track is stored, changed or removed. No JS-side
 * generation logic is needed.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { getEngine } from '@/shared/native/engine';
import { readHeatmapCacheSize } from './readHeatmapCacheSize';
import { nativeHeatmapTileUrl } from './tileTransport';

const HEATMAP_DIR = `${FileSystem.cacheDirectory}heatmap-tiles/`;

/**
 * The lowest zoom a raster source asks for. The engine draws tiles from zoom 1,
 * and a source declared above that leaves the zoomed-out map without heat.
 */
export const HEATMAP_SOURCE_MINZOOM = 0;

/**
 * What a surface should put in its raster source: the URL the platform
 * answers off the heatmap directory.
 */
export function heatmapTileTemplate(generation = 0): string {
  const template = nativeHeatmapTileUrl();
  // A finished pass is a different picture under the same path, and MapLibre
  // will not ask a URL it has already resolved. The interceptor reads the path
  // and drops the query on both platforms, so the version only moves the URL.
  return generation > 0 ? `${template}?v=${generation}` : template;
}

/** The base directory where heatmap tiles are stored */
export const HEATMAP_TILES_DIR = HEATMAP_DIR;

/**
 * Where builds before 0.3.0 drew the heatmap. An install upgraded from one can
 * still hold it, so turning the heatmap off and the wipe both delete it.
 */
export const LEGACY_HEATMAP_TILES_DIR = `${FileSystem.documentDirectory}heatmap-tiles/`;

/**
 * Total size of the heatmap tile cache in bytes, walked on a Rust thread and polled.
 *
 * Three mount effects ask for it and they share one walk, so the cost is one
 * pass however many screens are open.
 */
export async function readHeatmapTilesCacheSize(): Promise<number> {
  try {
    const engine = getEngine();
    if (!engine) return 0;
    return await readHeatmapCacheSize(engine, HEATMAP_DIR);
  } catch {
    return 0;
  }
}

/**
 * Clear the heatmap tiles in each of `dirs`, answering whether every set went.
 *
 * The engine stops a pass that is drawing before it deletes, and rejects when
 * a tile could not be removed, so false is heat still on disk and the caller
 * must not say the cache was cleared. Every directory is attempted whichever
 * one fails.
 */
export async function clearHeatmapTileSets(dirs: string[] = [HEATMAP_DIR]): Promise<boolean> {
  const engine = getEngine();
  if (!engine) return false;
  const outcomes = await Promise.allSettled(dirs.map((dir) => engine.clearHeatmapTiles(dir)));
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
  for (const failure of failures) {
    console.warn('[heatmap] Tiles left on disk:', failure.reason);
  }
  return failures.length === 0;
}
