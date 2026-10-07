/**
 * Hook for building all GeoJSON data for the regional map.
 * Builders cover activity markers, sections, the selected activity's route, and user location.
 *
 * CRITICAL INVARIANT: All GeoJSON builders return valid FeatureCollection (never null)
 * to avoid iOS Fabric crash when ShapeSources are conditionally added/removed.
 * Visibility is controlled via layer opacity, not feature presence.
 */

import { useMemo } from 'react';

import { convertLatLngTuples } from '@/shared/geo/polyline';
import type { ActivityBoundsItem } from '@/types';
import { sectionPalette, sectionPaletteIndex } from '@/theme/colors';
import type { MapSection } from '@/features/routes';
import { getActivityTypeConfig } from '../../lib/activityCategories';
import type { SelectedActivity } from './ActivityPopup';
import { EMPTY_FEATURE_COLLECTION } from '../../lib/coordinates';

// Size based on distance (always returns 24 - kept as function for future scaling)
const MARKER_SIZE = 24;
export function getMarkerSize(_distance: number): number {
  return MARKER_SIZE;
}

interface UseMapGeoJSONOptions {
  allActivities: ActivityBoundsItem[];
  activityCenters: Record<string, [number, number]>;
  /** Six fields and a line: everything the overlay draws, and nothing else. */
  sections: MapSection[];
  userLocation: [number, number] | null;
  selected: SelectedActivity | null;
}

interface UseMapGeoJSONResult {
  markersGeoJSON: GeoJSON.FeatureCollection;
  sectionsGeoJSON: GeoJSON.FeatureCollection;
  userLocationGeoJSON: GeoJSON.FeatureCollection;
  routeGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  routeHasData: boolean;
}

export function useMapGeoJSON({
  allActivities,
  activityCenters,
  sections,
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
  // 3. SECTIONS - Frequent road/trail section polylines
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no data
  const sectionsGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (sections.length === 0) return EMPTY_FEATURE_COLLECTION;

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
        // Keyed by id so the colour matches the activity map and survives a re-order.

        return {
          type: 'Feature' as const,
          id: section.id,
          properties: {
            id: section.id,
            name: section.name ?? '',
            visitCount: section.visitCount,
            distanceMeters: section.distanceMeters,
            color: sectionPalette[sectionPaletteIndex(section.id)],
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
  }, [sections]);

  // ===========================================
  // 7. USER LOCATION - Rendered as CircleLayer to avoid Fabric crash
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no location
  // Using CircleLayer instead of MarkerView prevents Fabric view recycling crash
  const userLocationGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    // Return empty collection when no location - visibility controlled via layer opacity
    if (!userLocation) {
      return EMPTY_FEATURE_COLLECTION;
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
  // 8. SELECTED ACTIVITY ROUTE - Full route line for selected activity
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
    sectionsGeoJSON,
    userLocationGeoJSON,
    routeGeoJSON,
    routeHasData,
  };
}
