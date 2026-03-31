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
