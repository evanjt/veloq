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

const HEATMAP_DIR = `${FileSystem.documentDirectory}heatmap-tiles/`;

/** file:// URL template for MapLibre RasterSource */
export const HEATMAP_TILE_URL_TEMPLATE = `${HEATMAP_DIR}{z}/{x}/{y}.png`;

/** The base directory where heatmap tiles are stored */
export const HEATMAP_TILES_DIR = HEATMAP_DIR;

/**
 * Get total size of heatmap tile cache in bytes.
 * Recursively scans the z/x/y.png directory structure.
 */
export async function getHeatmapTilesCacheSize(): Promise<number> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(HEATMAP_DIR);
    if (!dirInfo.exists) return 0;

    let totalSize = 0;
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
        for (const file of files) {
          if (!file.endsWith('.png')) continue;
          const info = await FileSystem.getInfoAsync(`${xPath}${file}`);
          if (info.exists && 'size' in info) {
            totalSize += info.size || 0;
          }
        }
      }
    }
    return totalSize;
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
