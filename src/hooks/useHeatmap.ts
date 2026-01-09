/**
 * Hook for generating and querying heatmaps.
 * Uses Rust for efficient grid computation.
 */

import { useMemo, useCallback, useEffect, useState } from 'react';
import { useEngineGroups } from './routes/useRouteEngine';
import { getNativeModule } from '@/lib/native/routeEngine';
import { routeEngine } from 'route-matcher-native';
import type {
  HeatmapResult,
  HeatmapConfig,
  HeatmapCell,
  CellQueryResult,
  ActivityHeatmapData,
  RouteSignature,
  GpsPoint,
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

    const nativeModule = getNativeModule();
    if (!nativeModule) {
      setHeatmap(null);
      setIsReady(false);
      return;
    }

    try {
      const allSignatures: RouteSignature[] = [];
      const activityData: ActivityHeatmapData[] = [];

      // Pre-filter groups by sport type before iterating
      const filteredGroups = sportType ? groups.filter((g) => g.sportType === sportType) : groups;

      // Get pre-computed bounds and distances from Rust engine
      // This avoids redundant Haversine calculations in JS
      const allBoundsData = routeEngine.getAllActivityBounds();
      const boundsMap = new Map(allBoundsData.map((b) => [b.id, b]));

      // Collect signatures from all groups
      for (const group of filteredGroups) {
        // Get signatures for this group (points and center already computed in Rust)
        const sigMap = nativeModule.routeEngine.getSignaturesForGroup(group.groupId);

        for (const [activityId, points] of Object.entries(sigMap)) {
          if (points.length < 2) continue;

          // Convert to GpsPoint format
          const gpsPoints: GpsPoint[] = points.map((p) => ({
            latitude: p.lat,
            longitude: p.lng,
          }));

          // Use pre-computed bounds and distance from engine (avoids JS calculation)
          const boundsData = boundsMap.get(activityId);
          let bounds = { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
          let totalDistance = 0;

          if (boundsData) {
            // boundsData.bounds is [[minLat, minLng], [maxLat, maxLng]]
            bounds = {
              minLat: boundsData.bounds[0][0],
              minLng: boundsData.bounds[0][1],
              maxLat: boundsData.bounds[1][0],
              maxLng: boundsData.bounds[1][1],
            };
            totalDistance = boundsData.distance;
          }

          // Build signature using pre-computed data
          const signature: RouteSignature = {
            activityId,
            points: gpsPoints,
            totalDistance,
            startPoint: gpsPoints[0],
            endPoint: gpsPoints[gpsPoints.length - 1],
            bounds,
            center: {
              latitude: (bounds.minLat + bounds.maxLat) / 2,
              longitude: (bounds.minLng + bounds.maxLng) / 2,
            },
          };

          allSignatures.push(signature);

          // Build activity data
          activityData.push({
            activityId,
            routeId: group.groupId,
            routeName: group.customName || null,
            timestamp: null,
          });
        }
      }

      if (allSignatures.length > 0) {
        const result = nativeModule.generateHeatmap(allSignatures, activityData, {
          cellSizeMeters,
        });
        setHeatmap(result);
        setIsReady(true);
      } else {
        setHeatmap(null);
        setIsReady(false);
      }
    } catch (error) {
      console.error('[useHeatmap] Error generating heatmap:', error);
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
