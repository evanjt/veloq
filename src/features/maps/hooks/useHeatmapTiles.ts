/**
 * The heatmap tile cache directory, the protocol template the WebView surfaces
 * read it through, and its size.
 *
 * Tile generation is handled entirely in Rust on a background thread -
 * triggered by the same events as section detection (GPS sync, section apply).
 * No JS-side generation logic needed.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { getEngine } from '@/shared/native/engine';
import { readHeatmapCacheSize } from '../lib/readHeatmapCacheSize';
import { nativeHeatmapTileUrl } from '../lib/tileTransport';

const HEATMAP_DIR = `${FileSystem.cacheDirectory}heatmap-tiles/`;

/**
 * Tile template for the WebView surfaces where no interceptor can answer. A
 * page cannot read the app's cache directory, so tiles come back over the
 * bridge through the `heatmap-file` protocol registered on the page. Measured
 * at 47.8 ms a tile against 6.6 ms intercepted, which is why every surface
 * asks [`heatmapTileTemplate`] instead of using this directly.
 */
export const HEATMAP_TILE_PROTOCOL_URL = 'heatmap-file://{z}/{x}/{y}.png';

/**
 * What a surface should put in its raster source: the intercepted URL where
 * the platform has an interceptor, and the bridge protocol where it does not.
 */
export function heatmapTileTemplate(generation = 0): string {
  const template = nativeHeatmapTileUrl() ?? HEATMAP_TILE_PROTOCOL_URL;
  // A finished pass is a different picture under the same path, and MapLibre
  // will not ask a URL it has already resolved. The interceptor reads the path
  // and drops the query on both platforms, so the version only moves the URL.
  return generation > 0 ? `${template}?v=${generation}` : template;
}

/** The base directory where heatmap tiles are stored */
export const HEATMAP_TILES_DIR = HEATMAP_DIR;

/**
 * Get total size of heatmap tile cache in bytes.
 *
 * Blocking. The native walk is linear in cached tiles and was measured at
 * 170 ms for 40,061 of them on the CPH2653, past the 100 ms a mount has for
 * the whole screen. Every mount path uses `readHeatmapTilesCacheSize`.
 */
export function getHeatmapTilesCacheSize(): number {
  try {
    const engine = getEngine();
    if (!engine) return 0;
    return engine.getHeatmapCacheSize(HEATMAP_DIR);
  } catch {
    return 0;
  }
}

/**
 * The same figure, walked on a Rust thread and polled.
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
