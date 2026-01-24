/**
 * Hook for generating and querying heatmaps.
 *
 * NOTE: Heatmap generation is currently disabled.
 * This stub returns null values to prevent errors while keeping the API stable.
 */

import { useCallback } from 'react';
import type { HeatmapResult, HeatmapCell, CellQueryResult, ActivityHeatmapData } from 'veloqrs';

export interface UseHeatmapOptions {
  /** Grid cell size in meters (default: 100m) */
  cellSizeMeters?: number;
  /** Filter by sport type */
  sportType?: string;
}

export interface UseHeatmapResult {
  /** Generated heatmap (null - disabled) */
  heatmap: HeatmapResult | null;
  /** Whether heatmap data is ready (always false - disabled) */
  isReady: boolean;
  /** Query a cell at a specific location (always returns null - disabled) */
  queryCell: (lat: number, lng: number) => CellQueryResult | null;
  /** Convert heatmap cells to GeoJSON for MapLibre (always returns null - disabled) */
  toGeoJSON: () => GeoJSON.FeatureCollection | null;
}

/**
 * Disabled heatmap hook - returns null/empty values.
 * The heatmap feature is disabled pending data validation fixes.
 */
export function useHeatmap(_options: UseHeatmapOptions = {}): UseHeatmapResult {
  const queryCell = useCallback((): CellQueryResult | null => null, []);
  const toGeoJSON = useCallback((): GeoJSON.FeatureCollection | null => null, []);

  return {
    heatmap: null,
    isReady: false,
    queryCell,
    toGeoJSON,
  };
}

// Re-export types for convenience
export type { HeatmapResult, HeatmapCell, CellQueryResult, ActivityHeatmapData };
