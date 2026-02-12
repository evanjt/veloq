/**
 * Hook for building all GeoJSON data for the regional map.
 * Contains 9 builders covering markers, traces, sections, routes, and user location.
 *
 * CRITICAL INVARIANT: All GeoJSON builders return valid FeatureCollection (never null)
 * to avoid iOS Fabric crash when ShapeSources are conditionally added/removed.
 * Visibility is controlled via layer opacity, not feature presence.
 */

import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { convertLatLngTuples } from '@/lib';
import type { ActivityBoundsItem, FrequentSection, ActivityType } from '@/types';
import { getActivityTypeConfig } from '../ActivityTypeFilter';
import type { RouteSignature } from '@/hooks/routes';
import type { SelectedActivity } from './ActivityPopup';

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Minimum route group fields needed for GeoJSON building */
interface RouteGroupMinimal {
  id: string;
  name: string;
  representativeId: string;
  activityCount: number;
  sportType: string;
  type: ActivityType;
  bestTime?: number;
}

export interface SectionMarker {
  id: string;
  name: string;
  coordinate: [number, number];
  sportType: string;
  visitCount: number;
}

export interface RouteMarker {
  id: string;
  name: string;
  coordinate: [number, number];
  activityCount: number;
  sportType: string;
}

// Size based on distance (always returns 24 — kept as function for future scaling)
const MARKER_SIZE = 24;
export function getMarkerSize(_distance: number): number {
  return MARKER_SIZE;
}

interface UseMapGeoJSONOptions {
  visibleActivities: ActivityBoundsItem[];
  activityCenters: Record<string, [number, number]>;
  routeSignatures: Record<string, RouteSignature>;
  sections: FrequentSection[];
  routeGroups: RouteGroupMinimal[];
  showRoutes: boolean;
  userLocation: [number, number] | null;
  selected: SelectedActivity | null;
  t: TFunction;
}

interface UseMapGeoJSONResult {
  markersGeoJSON: GeoJSON.FeatureCollection;
  tracesGeoJSON: GeoJSON.FeatureCollection;
  sectionsGeoJSON: GeoJSON.FeatureCollection;
  routesGeoJSON: GeoJSON.FeatureCollection;
  routeMarkersGeoJSON: GeoJSON.FeatureCollection;
  sectionMarkers: SectionMarker[];
  routeMarkers: RouteMarker[];
  userLocationGeoJSON: GeoJSON.FeatureCollection;
  routeGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  routeHasData: boolean;
}

export function useMapGeoJSON({
  visibleActivities,
  activityCenters,
  routeSignatures,
  sections,
  routeGroups,
  showRoutes,
  userLocation,
  selected,
  t,
}: UseMapGeoJSONOptions): UseMapGeoJSONResult {
  // ===========================================
  // 1. ACTIVITY MARKERS - Point features for CircleLayer hit detection
  // ===========================================
  // NOTE: Does NOT include isSelected - use MapLibre expressions with selectedActivityId
  // iOS crash fix: Filter out activities with undefined/invalid centers to prevent
  // -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207)
  const markersGeoJSON = useMemo(() => {
    let skippedCount = 0;
    const features = visibleActivities
      .map((activity) => {
        // Use pre-computed center (no format detection during render!)
        const center = activityCenters[activity.id];
        // iOS crash fix: guard against undefined activity centers
        // -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207)
        if (!center) return null;
        // Skip if center has invalid coordinates (prevents iOS crash)
        if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) {
          skippedCount++;
          if (__DEV__) {
            console.warn(
              `[useMapGeoJSON] INVALID MARKER: activity=${activity.id} center=${JSON.stringify(center)}`
            );
          }
          return null;
        }
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
      })
      .filter(Boolean);

    if (__DEV__ && skippedCount > 0) {
      console.warn(
        `[useMapGeoJSON] markersGeoJSON: skipped ${skippedCount}/${visibleActivities.length} activities with invalid centers`
      );
    }

    return {
      type: 'FeatureCollection' as const,
      features: features as GeoJSON.Feature[],
    };
  }, [visibleActivities, activityCenters]);

  // ===========================================
  // 2. GPS TRACES - Simplified routes shown when zoomed in
  // ===========================================
  // Build GeoJSON for GPS traces from route signatures
  // NOTE: Does NOT include isSelected - use MapLibre expressions with selectedActivityId
  // CRITICAL: Always return valid FeatureCollection to avoid iOS MapLibre crash
  // Fabric crash fix: Keep feature count STABLE to avoid "Attempt to recycle a mounted view"
  // Always include all traces in the GeoJSON - control visibility via layer opacity instead
  // NOTE: Empty FeatureCollection is valid - control visibility via layer opacity
  const tracesGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    // Always build full traces regardless of showTraces - visibility controlled by layer opacity
    let skippedCount = 0;
    const features = visibleActivities
      .filter((activity) => routeSignatures[activity.id]) // Only activities with signatures
      .map((activity) => {
        const signature = routeSignatures[activity.id];
        const config = getActivityTypeConfig(activity.type);
        const originalCount = signature.points.length;

        // Filter out NaN/Infinity coordinates and convert to GeoJSON [lng, lat]
        // GeoJSON LineString requires minimum 2 coordinates - invalid data causes iOS crash
        const coordinates = signature.points
          .filter((pt) => Number.isFinite(pt.lng) && Number.isFinite(pt.lat))
          .map((pt) => [pt.lng, pt.lat]);

        // Skip traces with insufficient valid coordinates
        if (coordinates.length < 2) {
          skippedCount++;
          if (__DEV__) {
            console.warn(
              `[useMapGeoJSON] INVALID TRACE: activity=${activity.id} originalPoints=${originalCount} validPoints=${coordinates.length}`
            );
          }
          return null;
        }

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
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    if (__DEV__ && skippedCount > 0) {
      console.warn(
        `[useMapGeoJSON] tracesGeoJSON: skipped ${skippedCount} traces with insufficient coordinates`
      );
    }

    if (features.length === 0) return EMPTY_COLLECTION;

    return { type: 'FeatureCollection', features };
  }, [visibleActivities, routeSignatures]);

  // ===========================================
  // 3. SECTIONS - Frequent road/trail section polylines
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no data
  const sectionsGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (sections.length === 0) return EMPTY_COLLECTION;

    let skippedCount = 0;
    const features = sections
      .map((section) => {
        // Filter out NaN coordinates and validate polyline has at least 2 points
        // GeoJSON LineString requires minimum 2 coordinates to be valid
        const originalCount = section.polyline.length;
        const validPoints = section.polyline.filter((pt) => !isNaN(pt.lat) && !isNaN(pt.lng));

        // Also filter Infinity values
        const finitePoints = validPoints.filter(
          (pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng)
        );

        // Skip sections with insufficient valid coordinates
        if (finitePoints.length < 2) {
          skippedCount++;
          if (__DEV__) {
            console.warn(
              `[useMapGeoJSON] INVALID SECTION: id=${section.id} name="${section.name}" originalPoints=${originalCount} validPoints=${validPoints.length} finitePoints=${finitePoints.length}`
            );
          }
          return null;
        }

        const coordinates = finitePoints.map((pt) => [pt.lng, pt.lat]);
        const config = getActivityTypeConfig(section.sportType);

        return {
          type: 'Feature' as const,
          id: section.id,
          properties: {
            id: section.id,
            name: section.name || t('sections.defaultName', { number: section.id.slice(-6) }),
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
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    if (__DEV__ && skippedCount > 0) {
      console.warn(
        `[useMapGeoJSON] sectionsGeoJSON: skipped ${skippedCount}/${sections.length} sections with invalid polylines`
      );
    }

    return { type: 'FeatureCollection', features };
  }, [sections, t]);

  // ===========================================
  // 4. ROUTES - Polylines for route groups
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no data
  const routesGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!showRoutes || routeGroups.length === 0) return EMPTY_COLLECTION;

    let skippedCount = 0;
    const features = routeGroups
      .filter((group) => routeSignatures[group.representativeId])
      .map((group) => {
        const signature = routeSignatures[group.representativeId];
        const originalCount = signature.points.length;
        // Filter out NaN/Infinity coordinates
        // GeoJSON LineString requires minimum 2 coordinates
        const coordinates = signature.points
          .filter((pt) => Number.isFinite(pt.lng) && Number.isFinite(pt.lat))
          .map((pt) => [pt.lng, pt.lat]);

        // Skip routes with insufficient valid coordinates
        if (coordinates.length < 2) {
          skippedCount++;
          if (__DEV__) {
            console.warn(
              `[useMapGeoJSON] INVALID ROUTE: groupId=${group.id} name="${group.name}" originalPoints=${originalCount} validPoints=${coordinates.length}`
            );
          }
          return null;
        }

        return {
          type: 'Feature' as const,
          id: group.id,
          properties: {
            id: group.id,
            name: group.name,
            activityCount: group.activityCount,
            sportType: group.sportType,
            type: group.type,
            bestTime: group.bestTime,
          },
          geometry: {
            type: 'LineString' as const,
            coordinates,
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    if (__DEV__ && skippedCount > 0) {
      console.warn(
        `[useMapGeoJSON] routesGeoJSON: skipped ${skippedCount}/${routeGroups.length} routes with invalid polylines`
      );
    }

    return { type: 'FeatureCollection', features };
  }, [showRoutes, routeGroups, routeSignatures]);

  // ===========================================
  // 5. ROUTE MARKERS - Start points for routes (GeoJSON for ShapeSource)
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no data
  const routeMarkersGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!showRoutes || routeGroups.length === 0) return EMPTY_COLLECTION;

    let skippedCount = 0;
    const features = routeGroups
      .filter((group) => routeSignatures[group.representativeId])
      .map((group) => {
        const signature = routeSignatures[group.representativeId];
        const startPoint = signature.points[0];

        // Skip if no start point or invalid coordinates
        if (!startPoint || !Number.isFinite(startPoint.lng) || !Number.isFinite(startPoint.lat)) {
          skippedCount++;
          if (__DEV__) {
            console.warn(
              `[useMapGeoJSON] INVALID ROUTE MARKER: groupId=${group.id} startPoint=${JSON.stringify(startPoint)}`
            );
          }
          return null;
        }

        return {
          type: 'Feature' as const,
          id: `marker-${group.id}`,
          properties: {
            id: group.id,
            name: group.name,
            activityCount: group.activityCount,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [startPoint.lng, startPoint.lat],
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    if (__DEV__ && skippedCount > 0) {
      console.warn(
        `[useMapGeoJSON] routeMarkersGeoJSON: skipped ${skippedCount} route markers with invalid start points`
      );
    }

    return { type: 'FeatureCollection', features };
  }, [showRoutes, routeGroups, routeSignatures]);

  // ===========================================
  // 6. SECTION MARKERS - Start point array for MarkerViews
  // ===========================================
  // CRITICAL: Do NOT filter based on showSections - always compute markers
  // to keep MarkerViews stable and avoid iOS crash during reconciliation
  const sectionMarkers = useMemo((): SectionMarker[] => {
    if (sections.length === 0) return [];

    return sections
      .map((section) => {
        // Get first point of section polyline
        const startPoint = section.polyline[0];
        if (!startPoint || !Number.isFinite(startPoint.lng) || !Number.isFinite(startPoint.lat)) {
          return null;
        }

        return {
          id: section.id,
          name: section.name ?? '',
          coordinate: [startPoint.lng, startPoint.lat] as [number, number],
          sportType: section.sportType,
          visitCount: section.visitCount,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [sections]);

  // ===========================================
  // 7. ROUTE MARKERS - Start point array for MarkerViews
  // ===========================================
  // CRITICAL: Do NOT filter based on showRoutes - always compute markers
  // to keep MarkerViews stable and avoid iOS crash during reconciliation
  const routeMarkers = useMemo((): RouteMarker[] => {
    if (routeGroups.length === 0) return [];

    return routeGroups
      .filter((group) => routeSignatures[group.representativeId])
      .map((group) => {
        const signature = routeSignatures[group.representativeId];
        const startPoint = signature.points[0];
        if (!startPoint || !Number.isFinite(startPoint.lng) || !Number.isFinite(startPoint.lat)) {
          return null;
        }

        return {
          id: group.id,
          name: group.name,
          coordinate: [startPoint.lng, startPoint.lat] as [number, number],
          activityCount: group.activityCount,
          sportType: group.sportType,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [routeGroups, routeSignatures]);

  // ===========================================
  // 8. USER LOCATION - Rendered as CircleLayer to avoid Fabric crash
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no location
  // Using CircleLayer instead of MarkerView prevents Fabric view recycling crash
  const userLocationGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    // Return empty collection when no location - visibility controlled via layer opacity
    if (!userLocation) {
      return EMPTY_COLLECTION;
    }
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { hasLocation: true },
          geometry: {
            type: 'Point',
            coordinates: userLocation,
          },
        },
      ],
    };
  }, [userLocation]);

  // ===========================================
  // 9. SELECTED ACTIVITY ROUTE - Full route line for selected activity
  // ===========================================
  // Uses pre-computed routeCoords (from Rust engine) if available, falls back to mapData.latlngs (from API)
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no data
  const routeGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    // Priority 1: Use pre-computed routeCoords from Rust engine (already in [lng, lat] format)
    if (selected?.routeCoords && selected.routeCoords.length >= 2) {
      return {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: selected.routeCoords,
        },
      };
    }

    // Priority 2: Fall back to mapData.latlngs from API
    if (!selected?.mapData?.latlngs) return EMPTY_COLLECTION;

    // Filter out null values first
    const nonNullCoords = selected.mapData.latlngs.filter((c): c is [number, number] => c !== null);

    if (nonNullCoords.length === 0) {
      if (__DEV__) {
        console.warn(
          `[useMapGeoJSON] routeGeoJSON: no non-null coords for activity=${selected.activity.id}`
        );
      }
      return EMPTY_COLLECTION;
    }

    // Convert to LatLng objects using the same function as ActivityMapView
    const latLngCoords = convertLatLngTuples(nonNullCoords);

    // Filter valid coordinates (including Infinity check) and convert to GeoJSON format [lng, lat]
    const validCoords = latLngCoords
      .filter(
        (c) =>
          Number.isFinite(c.latitude) &&
          Number.isFinite(c.longitude) &&
          !isNaN(c.latitude) &&
          !isNaN(c.longitude)
      )
      .map((c) => [c.longitude, c.latitude]);

    if (validCoords.length < 2) {
      if (__DEV__) {
        console.warn(
          `[useMapGeoJSON] routeGeoJSON: insufficient valid coords for activity=${selected.activity.id} original=${nonNullCoords.length} valid=${validCoords.length}`
        );
      }
      return EMPTY_COLLECTION;
    }

    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords,
      },
    };
  }, [selected?.routeCoords, selected?.mapData, selected?.activity.id]);

  // Helper to check if routeGeoJSON has data
  const routeHasData =
    routeGeoJSON.type === 'Feature' ||
    (routeGeoJSON.type === 'FeatureCollection' && routeGeoJSON.features.length > 0);

  return {
    markersGeoJSON,
    tracesGeoJSON,
    sectionsGeoJSON,
    routesGeoJSON,
    routeMarkersGeoJSON,
    sectionMarkers,
    routeMarkers,
    userLocationGeoJSON,
    routeGeoJSON,
    routeHasData,
  };
}
