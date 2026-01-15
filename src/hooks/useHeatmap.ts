/**
 * Hook for generating and querying heatmaps.
 * Uses Rust for efficient grid computation.
 *
 * NOTE: This hook requires additional Rust FFI methods that are not yet fully implemented.
 * Currently returns placeholder data.
 */

import { useCallback, useEffect, useState } from 'react';
import { useEngineGroups } from './routes/useRouteEngine';
import { getRouteEngine } from '@/lib/native/routeEngine';
import {
  ffiGenerateHeatmap,
  HeatmapConfig,
  type HeatmapResult,
  type HeatmapCell,
  type CellQueryResult,
  type ActivityHeatmapData,
  type GpsPoint,
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
 * Uses the Rust engine to get signatures and generate the heatmap.
 */
export function useHeatmap(options: UseHeatmapOptions = {}): UseHeatmapResult {
  const { cellSizeMeters = 100, sportType } = options;
  const { groups } = useEngineGroups({ minActivities: 1 });
  const [heatmap, setHeatmap] = useState<HeatmapResult | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Generate heatmap when groups change
  useEffect(() => {
    if (groups.length === 0) {
      setHeatmap(null);
      setIsReady(false);
      return;
    }

    const engine = getRouteEngine();
    if (!engine) {
      setHeatmap(null);
      setIsReady(false);
      return;
    }

    try {
      const signatures: RouteSignature[] = [];
      const activityData: ActivityHeatmapData[] = [];

      // Pre-filter groups by sport type before iterating
      const filteredGroups = sportType ? groups.filter((g) => g.sportType === sportType) : groups;

      // Collect signatures from all groups using consensus routes
      for (const group of filteredGroups) {
        // Get consensus route for this group
        const consensusPoints = engine.getConsensusRoutePoints(group.groupId);
        if (consensusPoints.length < 2) continue;

        // Build RouteSignature for this group
        const points: GpsPoint[] = consensusPoints.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
          elevation: undefined,
        }));

        // Calculate bounds
        let minLat = Infinity,
          maxLat = -Infinity,
          minLng = Infinity,
          maxLng = -Infinity;
        for (const p of points) {
          if (p.latitude < minLat) minLat = p.latitude;
          if (p.latitude > maxLat) maxLat = p.latitude;
          if (p.longitude < minLng) minLng = p.longitude;
          if (p.longitude > maxLng) maxLng = p.longitude;
        }

        // Calculate total distance (simple approximation)
        let totalDistance = 0;
        for (let i = 1; i < points.length; i++) {
          const dlat = (points[i].latitude - points[i - 1].latitude) * 111139;
          const dlng =
            (points[i].longitude - points[i - 1].longitude) *
            111139 *
            Math.cos((points[i].latitude * Math.PI) / 180);
          totalDistance += Math.sqrt(dlat * dlat + dlng * dlng);
        }

        signatures.push({
          activityId: group.groupId,
          points,
          totalDistance,
          startPoint: points[0],
          endPoint: points[points.length - 1],
          bounds: { minLat, maxLat, minLng, maxLng },
          center: {
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2,
            elevation: undefined,
          },
        });

        // Build activity data for each activity in group
        for (const activityId of group.activityIds) {
          activityData.push({
            activityId,
            routeId: group.groupId,
            routeName: group.customName,
            timestamp: undefined,
          });
        }
      }

      if (signatures.length > 0 && activityData.length > 0) {
        // Create config
        const config = HeatmapConfig.create({
          cellSizeMeters,
          bounds: undefined,
        });

        // Generate heatmap using FFI
        const result = ffiGenerateHeatmap(signatures, activityData, config);
        setHeatmap(result);
        setIsReady(true);
      } else {
        setHeatmap(null);
        setIsReady(false);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[useHeatmap] Error generating heatmap:', error);
      }
      setHeatmap(null);
      setIsReady(false);
    }
  }, [groups, cellSizeMeters, sportType]);

  // Query cell at location
  const queryCell = useCallback(
    (lat: number, lng: number): CellQueryResult | null => {
      if (!heatmap) return null;

      // Find cell containing the point
      const { bounds, gridRows, gridCols, cells } = heatmap;
      const cellHeight = (bounds.maxLat - bounds.minLat) / gridRows;
      const cellWidth = (bounds.maxLng - bounds.minLng) / gridCols;

      const row = Math.floor((lat - bounds.minLat) / cellHeight);
      const col = Math.floor((lng - bounds.minLng) / cellWidth);

      if (row < 0 || row >= gridRows || col < 0 || col >= gridCols) {
        return null;
      }

      // Find cell
      const cell = cells.find((c) => c.row === row && c.col === col);
      if (!cell) return null;

      // Build suggested label from route info
      const uniqueRoutes = new Set(cell.routeRefs.map((r) => r.name).filter(Boolean));
      const suggestedLabel =
        uniqueRoutes.size > 0
          ? Array.from(uniqueRoutes).slice(0, 2).join(', ')
          : `${cell.activityIds.length} activities`;

      return {
        cell,
        suggestedLabel,
      };
    },
    [heatmap]
  );

  // Convert to GeoJSON for MapLibre rendering
  const toGeoJSON = useCallback((): GeoJSON.FeatureCollection | null => {
    if (!heatmap || heatmap.cells.length === 0) return null;

    const { bounds, gridRows, gridCols, maxDensity, cells } = heatmap;
    const cellHeight = (bounds.maxLat - bounds.minLat) / gridRows;
    const cellWidth = (bounds.maxLng - bounds.minLng) / gridCols;

    const features: GeoJSON.Feature[] = cells.map((cell) => {
      const minLat = bounds.minLat + cell.row * cellHeight;
      const minLng = bounds.minLng + cell.col * cellWidth;
      const maxLat = minLat + cellHeight;
      const maxLng = minLng + cellWidth;

      return {
        type: 'Feature' as const,
        properties: {
          density: cell.density,
          normalizedDensity: maxDensity > 0 ? cell.density / maxDensity : 0,
          activityCount: cell.activityIds.length,
          routeCount: cell.uniqueRouteCount,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ],
          ],
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
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
export type { HeatmapResult, HeatmapConfig, HeatmapCell, CellQueryResult, ActivityHeatmapData };
