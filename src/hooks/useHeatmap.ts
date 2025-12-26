/**
 * Hook for generating and querying heatmaps.
 * Uses Rust for efficient grid computation.
 */

import { useMemo, useCallback } from 'react';
import { useRouteMatchStore } from '@/providers';
import {
  generateHeatmap as nativeGenerateHeatmap,
  queryHeatmapCell as nativeQueryHeatmapCell,
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
 * Uses cached route signatures from RouteMatchStore.
 */
export function useHeatmap(options: UseHeatmapOptions = {}): UseHeatmapResult {
  const { cellSizeMeters = 100, sportType } = options;

  // Get cached data from route match store
  const signatures = useRouteMatchStore((s) => s.cache?.signatures ?? {});
  const groups = useRouteMatchStore((s) => s.cache?.groups ?? []);
  const activityMetadata = useRouteMatchStore((s) => s.cache?.activityMetadata ?? {});

  // Build activity -> route mapping
  const activityToRoute = useMemo(() => {
    const map: Record<string, string> = {};
    for (const group of groups) {
      for (const activityId of group.activityIds) {
        map[activityId] = group.groupId;
      }
    }
    return map;
  }, [groups]);

  // Build activity data for heatmap generation
  const activityData = useMemo((): ActivityHeatmapData[] => {
    return Object.entries(signatures).map(([activityId, sig]) => {
      const meta = activityMetadata[activityId];
      const routeId = activityToRoute[activityId] ?? null;

      // Find route name from group
      const group = groups.find(g => g.groupId === routeId);
      const routeName = group ? `Route ${group.groupId.slice(-6)}` : null;

      return {
        activityId,
        routeId,
        routeName,
        timestamp: meta?.date ? new Date(meta.date).getTime() / 1000 : null,
      };
    });
  }, [signatures, activityMetadata, activityToRoute, groups]);

  // Filter signatures by sport type if specified
  const filteredSignatures = useMemo((): RouteSignature[] => {
    const allSigs = Object.values(signatures);
    if (!sportType) return allSigs;

    return allSigs.filter(sig => {
      const meta = activityMetadata[sig.activityId];
      return meta?.type === sportType;
    });
  }, [signatures, activityMetadata, sportType]);

  // Generate heatmap
  const heatmap = useMemo((): HeatmapResult | null => {
    if (filteredSignatures.length === 0) return null;

    const config: Partial<HeatmapConfig> = {
      cellSizeMeters,
    };

    return nativeGenerateHeatmap(filteredSignatures, activityData, config);
  }, [filteredSignatures, activityData, cellSizeMeters]);

  const isReady = heatmap !== null && heatmap.cells.length > 0;

  // Query cell at location
  const queryCell = useCallback((lat: number, lng: number): CellQueryResult | null => {
    if (!heatmap) return null;
    return nativeQueryHeatmapCell(heatmap, lat, lng);
  }, [heatmap]);

  // Convert to GeoJSON for MapLibre rendering
  const toGeoJSON = useCallback((): GeoJSON.FeatureCollection | null => {
    if (!heatmap || heatmap.cells.length === 0) return null;

    const features: GeoJSON.Feature[] = heatmap.cells.map((cell) => ({
      type: 'Feature',
      id: `cell-${cell.row}-${cell.col}`,
      properties: {
        row: cell.row,
        col: cell.col,
        density: cell.density,
        visitCount: cell.visitCount,
        uniqueRouteCount: cell.uniqueRouteCount,
        activityCount: cell.activityIds.length,
        isCommonPath: cell.isCommonPath,
      },
      geometry: {
        type: 'Point',
        coordinates: [cell.centerLng, cell.centerLat],
      },
    }));

    return {
      type: 'FeatureCollection',
      features,
    };
  }, [heatmap]);

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
