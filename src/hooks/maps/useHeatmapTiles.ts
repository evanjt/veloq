/**
 * Provides the file:// URL template for MapLibre to consume heatmap tiles,
 * and a clear function for the settings cache panel.
 *
 * Tile generation is handled entirely in Rust on a background thread —
 * triggered by the same events as section detection (GPS sync, section apply).
 * No JS-side generation logic needed.
 */

import { useCallback } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { getRouteEngine } from '@/lib/native/routeEngine';

const HEATMAP_DIR = `${FileSystem.cacheDirectory}heatmap-tiles/`;

/** file:// URL template for MapLibre RasterSource */
export const HEATMAP_TILE_URL_TEMPLATE = `${HEATMAP_DIR}{z}/{x}/{y}.png`;

/** The base directory where heatmap tiles are stored */
export const HEATMAP_TILES_DIR = HEATMAP_DIR;

/**
 * Get total size of heatmap tile cache in bytes.
 * Counts PNG files and estimates size to avoid slow per-file stat calls.
 * Falls back to sampling a few tiles for average size.
 */
export async function getHeatmapTilesCacheSize(): Promise<number> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(HEATMAP_DIR);
    if (!dirInfo.exists) return 0;

    let fileCount = 0;
    let sampledSize = 0;
    let sampledCount = 0;

    const zoomDirs = await FileSystem.readDirectoryAsync(HEATMAP_DIR);
    for (const zDir of zoomDirs) {
      const zPath = `${HEATMAP_DIR}${zDir}/`;
      const zInfo = await FileSystem.getInfoAsync(zPath);
      if (!zInfo.exists || !zInfo.isDirectory) continue;

      const xDirs = await FileSystem.readDirectoryAsync(zPath);
      for (const xDir of xDirs) {
        const xPath = `${zPath}${xDir}/`;
        const xInfo = await FileSystem.getInfoAsync(xPath);
        if (!xInfo.exists || !xInfo.isDirectory) continue;

        const files = await FileSystem.readDirectoryAsync(xPath);
        const pngCount = files.filter((f) => f.endsWith('.png')).length;
        fileCount += pngCount;

        // Sample first few tiles for average size (avoid stat-ing every file)
        if (sampledCount < 5 && pngCount > 0) {
          const sampleFile = files.find((f) => f.endsWith('.png'));
          if (sampleFile) {
            const info = await FileSystem.getInfoAsync(`${xPath}${sampleFile}`);
            if (info.exists && 'size' in info && info.size) {
              sampledSize += info.size;
              sampledCount++;
            }
          }
        }
      }
    }

    if (fileCount === 0) return 0;
    const avgSize = sampledCount > 0 ? sampledSize / sampledCount : 50000; // 50KB default
    return Math.round(fileCount * avgSize);
  } catch {
    return 0;
  }
}

export function useHeatmapTiles(): {
  tileUrlTemplate: string;
  clearAllTiles: () => void;
} {
  const clearAllTiles = useCallback(() => {
    getRouteEngine()?.clearHeatmapTiles(HEATMAP_DIR);
  }, []);

  return {
    tileUrlTemplate: HEATMAP_TILE_URL_TEMPLATE,
    clearAllTiles,
  };
}
