/**
 * Hook for building GeoJSON data for the regional map.
 * Extracts GeoJSON computation logic from RegionalMapView.
 */

import { useMemo } from 'react';
import type { ActivityBoundsItem, FrequentSection } from '@/types';
import { getActivityTypeConfig } from '../ActivityTypeFilter';
import type { RouteSignature } from '@/hooks/routes';

interface UseMapGeoJSONOptions {
  activities: ActivityBoundsItem[];
  visibleActivities: ActivityBoundsItem[];
  activityCenters: Record<string, [number, number]>;
  routeSignatures: Record<string, RouteSignature>;
  sections: FrequentSection[];
  showTraces: boolean;
  selectedActivityId: string | null;
}

interface UseMapGeoJSONResult {
  markersGeoJSON: GeoJSON.FeatureCollection;
  tracesGeoJSON: GeoJSON.FeatureCollection | null;
  sectionsGeoJSON: GeoJSON.FeatureCollection | null;
}

// Calculate marker size based on distance
function getMarkerSize(distance: number): number {
  if (distance < 5000) return 20; // < 5km
  if (distance < 15000) return 24; // 5-15km
  if (distance < 30000) return 28; // 15-30km
  return 32; // > 30km
}

export function useMapGeoJSON({
  visibleActivities,
  activityCenters,
  routeSignatures,
  sections,
  showTraces,
  selectedActivityId,
}: UseMapGeoJSONOptions): UseMapGeoJSONResult {
  // Build GeoJSON feature collection for activity markers
  // NOTE: Does NOT include isSelected - use MapLibre expressions with selectedActivityId
  const markersGeoJSON = useMemo(() => {
    const features = visibleActivities.map((activity) => {
      const center = activityCenters[activity.id];
      const config = getActivityTypeConfig(activity.type);
      const size = getMarkerSize(activity.distance);

      return {
        type: 'Feature' as const,
        id: activity.id,
        properties: {
          id: activity.id,
          type: activity.type,
          color: config.color,
          size: size,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: center,
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [visibleActivities, activityCenters]);

  // Build GeoJSON for GPS traces from route signatures
  const tracesGeoJSON = useMemo(() => {
    if (!showTraces) return null;

    const features = visibleActivities
      .filter((activity) => routeSignatures[activity.id])
      .map((activity) => {
        const signature = routeSignatures[activity.id];
        const config = getActivityTypeConfig(activity.type);
        const coordinates = signature.points.map((pt) => [pt.lng, pt.lat]);

        return {
          type: 'Feature' as const,
          id: `trace-${activity.id}`,
          properties: {
            id: activity.id,
            color: config.color,
          },
          geometry: {
            type: 'LineString' as const,
            coordinates,
          },
        };
      });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [showTraces, visibleActivities, routeSignatures]);

  // Build GeoJSON for frequent sections
  const sectionsGeoJSON = useMemo(() => {
    if (sections.length === 0) return null;

    const features = sections.map((section) => {
      const coordinates = section.polyline.map((pt) => [pt.lng, pt.lat]);
      const config = getActivityTypeConfig(section.sportType);

      return {
        type: 'Feature' as const,
        id: section.id,
        properties: {
          id: section.id,
          name: section.name || `Section ${section.id.slice(-6)}`,
          sportType: section.sportType,
          visitCount: section.visitCount,
          distanceMeters: section.distanceMeters,
          color: config.color,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates,
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [sections]);

  return {
    markersGeoJSON,
    tracesGeoJSON,
    sectionsGeoJSON,
  };
}

export { getMarkerSize };
