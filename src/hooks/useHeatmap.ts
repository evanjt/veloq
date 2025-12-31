/**
 * Hook for generating and querying heatmaps.
 * Uses Rust for efficient grid computation.
 */

import { useMemo, useCallback, useEffect, useState } from 'react';
import { useEngineGroups } from './routes/useRouteEngine';
import { getNativeModule } from '@/lib/native/routeEngine';
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
 * Calculate distance between two GPS points using Haversine formula
 */
function haversineDistance(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate total distance of a route
 */
function calculateRouteDistance(points: Array<{ lat: number; lng: number }>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(points[i - 1], points[i]);
  }
  return total;
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
      const filteredGroups = sportType
        ? groups.filter(g => g.sportType === sportType)
        : groups;

      // Collect signatures from all groups
      for (const group of filteredGroups) {
        // Get signatures for this group
        const sigMap = nativeModule.routeEngine.getSignaturesForGroup(group.groupId);

        for (const [activityId, points] of Object.entries(sigMap)) {
          if (points.length < 2) continue;

          // Calculate bounds
          let minLat = Infinity, maxLat = -Infinity;
          let minLng = Infinity, maxLng = -Infinity;
          for (const p of points) {
            minLat = Math.min(minLat, p.lat);
            maxLat = Math.max(maxLat, p.lat);
            minLng = Math.min(minLng, p.lng);
            maxLng = Math.max(maxLng, p.lng);
          }

          // Convert to GpsPoint format
          const gpsPoints: GpsPoint[] = points.map(p => ({
            latitude: p.lat,
            longitude: p.lng,
          }));

          // Build signature
          const signature: RouteSignature = {
            activityId,
            points: gpsPoints,
            totalDistance: calculateRouteDistance(points),
            startPoint: gpsPoints[0],
            endPoint: gpsPoints[gpsPoints.length - 1],
            bounds: { minLat, maxLat, minLng, maxLng },
            center: {
              latitude: (minLat + maxLat) / 2,
              longitude: (minLng + maxLng) / 2,
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
        const result = nativeModule.generateHeatmap(allSignatures, activityData, { cellSizeMeters });
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
  const queryCell = useCallback((lat: number, lng: number): CellQueryResult | null => {
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
    const cell = cells.find(c => c.row === row && c.col === col);
    if (!cell) return null;

    // Build suggested label from route info
    const uniqueRoutes = new Set(cell.routeRefs.map(r => r.routeName).filter(Boolean));
    const suggestedLabel = uniqueRoutes.size > 0
      ? Array.from(uniqueRoutes).slice(0, 2).join(', ')
      : `${cell.activityIds.length} activities`;

    return {
      cell,
      suggestedLabel,
    };
  }, [heatmap]);

  // Convert to GeoJSON for MapLibre rendering
  const toGeoJSON = useCallback((): GeoJSON.FeatureCollection | null => {
    if (!heatmap || heatmap.cells.length === 0) return null;

    const { bounds, gridRows, gridCols, maxDensity, cells } = heatmap;
    const cellHeight = (bounds.maxLat - bounds.minLat) / gridRows;
    const cellWidth = (bounds.maxLng - bounds.minLng) / gridCols;

    const features: GeoJSON.Feature[] = cells.map(cell => {
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
          coordinates: [[
            [minLng, minLat],
            [maxLng, minLat],
            [maxLng, maxLat],
            [minLng, maxLat],
            [minLng, minLat],
          ]],
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
export type {
  HeatmapResult,
  HeatmapConfig,
  HeatmapCell,
  CellQueryResult,
  ActivityHeatmapData,
};
