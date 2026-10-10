/**
 * Hook for building all GeoJSON data for the regional map.
 * Builders cover activity markers, the selected activity's route, and user location. The
 * section overlay is built where the map read is held, in `sectionLineCollection`.
 *
 * Invariant: every builder returns a FeatureCollection, never null, so each
 * source spec stays in the list. With no data it returns the one shared
 * EMPTY_FEATURE_COLLECTION, which the surface patcher compares by identity and
 * skips unsent. Visibility is controlled via layer opacity, not feature presence.
 */

import { useMemo } from 'react';

import { convertLatLngTuples } from '@/shared/geo/polyline';
import type { ActivityBoundsItem } from '@/types';
import { getActivityTypeConfig } from '../../lib/activityCategories';
import type { SelectedActivity } from './ActivityPopup';
import { EMPTY_FEATURE_COLLECTION } from '../../lib/coordinates';
import { buildUserLocationCollection } from '../../lib/userLocationLayer';

// Size based on distance (always returns 24 - kept as function for future scaling)
const MARKER_SIZE = 24;
export function getMarkerSize(_distance: number): number {
  return MARKER_SIZE;
}

interface UseMapGeoJSONOptions {
  allActivities: ActivityBoundsItem[];
  activityCenters: Record<string, [number, number]>;
  userLocation: [number, number] | null;
  selected: SelectedActivity | null;
}

interface UseMapGeoJSONResult {
  markersGeoJSON: GeoJSON.FeatureCollection;
  userLocationGeoJSON: GeoJSON.FeatureCollection;
  routeGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  routeHasData: boolean;
}

export function useMapGeoJSON({
  allActivities,
  activityCenters,
  userLocation,
  selected,
}: UseMapGeoJSONOptions): UseMapGeoJSONResult {
  // ===========================================
  // 1. ACTIVITY MARKERS - Point features for CircleLayer hit detection
  // ===========================================
  // NOTE: Does NOT include isSelected - use MapLibre expressions with selectedActivityId
  // iOS crash fix: Filter out activities with undefined/invalid centers to prevent
  // -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207)
  // CRITICAL: Use allActivities (not visibleActivities) so MapLibre Supercluster has the
  // complete point set for correct cluster hierarchies and counts at all zoom levels.
  const markersGeoJSON = useMemo(() => {
    let skippedCount = 0;
    // One clock read for the whole set, so every marker ages against the same
    // instant rather than against its own microsecond.
    const now = Date.now();
    const features = allActivities
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
        // Recency: 0 = today, 1 = 1+ year old (for opacity fade on unclustered points)
        const ageMs = now - new Date(activity.date).getTime();
        const age = Math.min(ageMs / (365 * 24 * 60 * 60 * 1000), 1);

        return {
          type: 'Feature' as const,
          // No top-level `id` - string IDs break MapLibre Supercluster clustering.
          // Use properties.id for tap handlers and selection expressions.
          properties: {
            id: activity.id,
            type: activity.type,
            color: config.color,
            size: size,
            age: Math.round(age * 100) / 100, // 2 decimal places
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
        `[useMapGeoJSON] markersGeoJSON: skipped ${skippedCount}/${allActivities.length} activities with invalid centers`
      );
    }

    return {
      type: 'FeatureCollection' as const,
      features: features as GeoJSON.Feature[],
    };
  }, [allActivities, activityCenters]);

  // ===========================================
  // 7. USER LOCATION - Rendered as a circle layer
  // ===========================================
  // Never null: with no fix, the shared empty collection keeps the source unsent
  const userLocationGeoJSON = useMemo(
    () => buildUserLocationCollection(userLocation),
    [userLocation]
  );

  // ===========================================
  // 8. SELECTED ACTIVITY ROUTE - Full route line for selected activity
  // ===========================================
  // Uses pre-computed routeCoords (from Rust engine) if available, falls back to mapData.latlngs (from API)
  // Never null: with no route, the shared empty collection keeps the source unsent
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
    if (!selected?.mapData?.latlngs) return EMPTY_FEATURE_COLLECTION;

    // Filter out null values first
    const nonNullCoords = selected.mapData.latlngs.filter((c): c is [number, number] => c !== null);

    if (nonNullCoords.length === 0) {
      if (__DEV__) {
        console.warn(
          `[useMapGeoJSON] routeGeoJSON: no non-null coords for activity=${selected.activity.id}`
        );
      }
      return EMPTY_FEATURE_COLLECTION;
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
      return EMPTY_FEATURE_COLLECTION;
    }

    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords,
      },
    };
  }, [selected]);

  // Helper to check if routeGeoJSON has data
  const routeHasData =
    routeGeoJSON.type === 'Feature' ||
    (routeGeoJSON.type === 'FeatureCollection' && routeGeoJSON.features.length > 0);

  return {
    markersGeoJSON,
    userLocationGeoJSON,
    routeGeoJSON,
    routeHasData,
  };
}
