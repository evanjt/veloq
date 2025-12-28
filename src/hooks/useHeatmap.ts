/**
 * Hook for generating and querying heatmaps.
 * Uses Rust for efficient grid computation.
 *
 * Note: Heatmap generation currently requires signatures which are internal
 * to the Rust engine. This hook is a placeholder for future implementation.
 */

import { useMemo, useCallback } from 'react';
import { useEngineGroups } from './routes/useRouteEngine';
import {
  type HeatmapResult,
  type HeatmapConfig,
  type HeatmapCell,
  type CellQueryResult,
  type ActivityHeatmapData,
  type RouteSignature,
} from 'route-matcher-native';

export interface UseHeatmapOptions {
  /** Grid cell size in meters (default: 100m) */
  cellSizeMeters?: number;
  /** Filter by sport type */
  sportType?: string;
}

export interface UseHeatmapResult {
  /** Generated heatmap (null if not ready) */
  heatmap: HeatmapResult | null;
  /** Whether heatmap data is ready */
  isReady: boolean;
  /** Query a cell at a specific location */
  queryCell: (lat: number, lng: number) => CellQueryResult | null;
  /** Convert heatmap cells to GeoJSON for MapLibre */
  toGeoJSON: () => GeoJSON.FeatureCollection | null;
}

/**
 * Hook for generating and querying activity heatmaps.
 *
 * TODO: Implement heatmap generation using the persistent Rust engine.
 * Currently returns null as signatures are internal to the engine.
 */
export function useHeatmap(options: UseHeatmapOptions = {}): UseHeatmapResult {
  const { cellSizeMeters = 100, sportType } = options;

  // Get groups from engine (heatmap would need internal signatures)
  const { groups } = useEngineGroups({ minActivities: 1 });

  // Heatmap is not currently available without direct signature access
  const heatmap = null;
  const isReady = false;

  // Query cell at location
  const queryCell = useCallback((lat: number, lng: number): CellQueryResult | null => {
    return null;
  }, []);

  // Convert to GeoJSON for MapLibre rendering
  const toGeoJSON = useCallback((): GeoJSON.FeatureCollection | null => {
    return null;
  }, []);

  return {
    heatmap,
    isReady,
    queryCell,
    toGeoJSON,
  };
}

// Re-export types for convenience
export type {
  HeatmapResult,
  HeatmapConfig,
  HeatmapCell,
  CellQueryResult,
  ActivityHeatmapData,
};
