/**
 * Hook for RegionalMapView event handlers.
 * Extracts handler logic from the main component for better organization.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location'; // 30 seconds
import { normalizeBounds } from '@/shared/geo/polyline';
import { activitySpatialIndex, mapBoundsToViewport } from '@/shared/geo/spatialIndex';
import { planClusterZoom } from '@/features/maps/lib/clusterZoom';
import { saveMapCameraState } from '@/features/maps/lib/storage/mapCameraState';
import { startFetchAndStore } from 'veloqrs';
import { getRouteEngine } from '@/shared/native/routeEngine';
import type { ActivityBoundsItem, FrequentSection } from '@/types';
import type { SelectedActivity } from './ActivityPopup';
import type { Map3DWebViewRef } from '../Map3DWebView';
import type { MapCameraState, MapPressEvent, MapSurfaceRef } from '../MapSurface';
import {
  CLUSTER_SOURCE_ID,
  CLUSTER_CIRCLE_LAYER_ID,
  SECTIONS_LINE_LAYER_ID,
  SPIDER_POINT_LAYER_ID,
  UNCLUSTERED_POINT_LAYER_ID,
} from './regionalMapLayerSpecs';
import { REGIONAL_FIT_PADDING } from './regionalCamera';
import {
  REGION_CHANGE_DEBOUNCE_MS,
  REGION_SETTLE_DEBOUNCE_MS,
  VIEWPORT_CULLING_THRESHOLD,
} from '@/features/maps/lib/mapBudgets';
// Cache for last known location (avoid slow GPS re-acquisition)
const LOCATION_CACHE_MAX_AGE_MS = 30000;

/** How long to wait for a single on-demand GPS download before giving up. */
const GPS_WAIT_TIMEOUT_MS = 15_000;
const GPS_WAIT_POLL_MS = 250;

/**
 * Poll the engine for an activity's track after asking Rust to download it.
 * Rust cannot push into the JS listener map, so arrival is observed.
 */
async function waitForGpsTrack(activityId: string): Promise<[number, number][] | null> {
  const deadline = Date.now() + GPS_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const points = getRouteEngine()?.getGpsTrack(activityId);
    if (points && points.length > 0) {
      return points.map((p) => [p.latitude, p.longitude] as [number, number]);
    }
    await new Promise((resolve) => setTimeout(resolve, GPS_WAIT_POLL_MS));
  }
  return null;
}

/** State for spider/fan-out expansion of clusters at max zoom */
export interface SpiderState {
  center: [number, number]; // [lng, lat] cluster center
  leaves: GeoJSON.Feature[]; // individual activity features from the cluster
}

interface UseMapHandlersOptions {
  activities: ActivityBoundsItem[];
  sections: FrequentSection[];
  selected: SelectedActivity | null;
  setSelected: (value: SelectedActivity | null) => void;
  setSelectedSection: (value: FrequentSection | null) => void;
  showActivities: boolean;
  setShowActivities: (value: boolean | ((prev: boolean) => boolean)) => void;
  showSections: boolean;
  setShowSections: (value: boolean | ((prev: boolean) => boolean)) => void;
  showRoutes: boolean;
  setShowRoutes: (value: boolean | ((prev: boolean) => boolean)) => void;
  setSelectedRoute: (value: null) => void;
  userLocation: [number, number] | null;
  setUserLocation: (value: [number, number] | null) => void;
  setLocationLoading: (value: boolean) => void;
  setVisibleActivityIds: (value: Set<string> | null) => void;
  currentZoomRef: React.MutableRefObject<number>;
  currentCenterRef: React.MutableRefObject<[number, number] | null>;
  setAboveTraceZoom: (value: boolean) => void;
  traceZoomThreshold: number;
  onCameraSettled?: (center: [number, number], zoom: number) => void;
  surfaceRef: React.RefObject<MapSurfaceRef | null>;
  map3DRef: React.RefObject<Map3DWebViewRef | null>;
  bearingAnim: Animated.Value;
  currentZoomLevel: React.MutableRefObject<number>;
  is3DMode: boolean;
  markUserInteracted: () => void;
  setSpider: (state: SpiderState | null) => void;
}

interface UseMapHandlersResult {
  handleMarkerTap: (activity: ActivityBoundsItem) => void;
  handleClosePopup: () => void;
  handleViewDetails: () => void;
  handleZoomToActivity: () => void;
  /** Single tap entry point. The page has already resolved which layer was hit. */
  handleSurfacePress: (event: MapPressEvent) => void;
  handleRegionIsChanging: (state: MapCameraState) => void;
  handleRegionDidChange: (state: MapCameraState) => void;
  handleGetLocation: () => Promise<void>;
  toggleActivities: () => void;
  toggleSections: () => void;
  toggleRoutes: () => void;
  resetOrientation: () => void;
  handleFitAll: () => void;
}

export function useMapHandlers({
  activities,
  sections,
  selected,
  setSelected,
  setSelectedSection,
  setShowActivities,
  setShowSections,
  setShowRoutes,
  setSelectedRoute,
  setUserLocation,
  setLocationLoading,
  setVisibleActivityIds,
  currentZoomRef,
  currentCenterRef,
  setAboveTraceZoom,
  traceZoomThreshold,
  onCameraSettled,
  surfaceRef,
  map3DRef,
  bearingAnim,
  currentZoomLevel,
  is3DMode,
  markUserInteracted,
  setSpider,
}: UseMapHandlersOptions): UseMapHandlersResult {
  const router = useRouter();

  // Ref to access current selected without adding it as callback dependency
  // This keeps callbacks stable for React.memo optimization
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Debounce timers for region change handlers
  const visibleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomCenterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track previous visible IDs to avoid creating new Set references when content hasn't changed
  const prevVisibleKeyRef = useRef<string>('');
  // Track previous viewport bounds to skip queryViewport FFI calls when camera hasn't moved
  const prevBoundsKeyRef = useRef<string>('');
  // Track previous center/zoom to skip redundant ref updates and threshold checks
  const prevCenterRef = useRef<[number, number] | null>(null);
  const prevZoomRef = useRef<number>(-1);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      if (visibleDebounceRef.current) clearTimeout(visibleDebounceRef.current);
      if (zoomCenterDebounceRef.current) clearTimeout(zoomCenterDebounceRef.current);
    };
  }, []);

  // Handle marker tap - no auto-zoom to prevent jarring camera movements
  // Uses local cached GPS data from Rust engine for instant response
  // PERF: Show popup immediately, load route data after
  const handleMarkerTap = useCallback(
    (activity: ActivityBoundsItem) => {
      // Show popup immediately with activity info (no route yet)
      setSelected({
        activity,
        mapData: {
          bounds: activity.bounds,
          latlngs: null,
          route: null,
          weather: null,
        },
        routeCoords: undefined,
        isLoading: true,
      });

      // Load route data after popup is shown (non-blocking)
      requestAnimationFrame(() => {
        const engine = getRouteEngine();
        const localTrack = engine?.getGpsTrack(activity.id);

        if (localTrack && localTrack.length > 0) {
          // Convert directly to GeoJSON format [lng, lat][]
          const routeCoords: [number, number][] = [];
          for (const p of localTrack) {
            if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
              routeCoords.push([p.longitude, p.latitude]);
            }
          }
          setSelected({
            activity,
            mapData: {
              bounds: activity.bounds,
              latlngs: null,
              route: null,
              weather: null,
            },
            routeCoords,
            isLoading: false,
          });
        } else {
          // No local track yet. Ask Rust to download and store this one
          // activity's GPS, then read it back the same way as any other.
          startFetchAndStore(
            [activity.id],
            [{ activityId: activity.id, sportType: activity.type }]
          );
          setSelected({ activity, mapData: null, isLoading: true });
          waitForGpsTrack(activity.id).then((coords) => {
            setSelected({
              activity,
              mapData: coords
                ? { bounds: activity.bounds, latlngs: coords, route: null, weather: null }
                : null,
              isLoading: false,
            });
          });
        }
      });
    },
    [setSelected]
  );

  // Close popup
  const handleClosePopup = useCallback(() => {
    setSelected(null);
  }, [setSelected]);

  // Navigate to activity detail - uses ref for stable callback
  const handleViewDetails = useCallback(() => {
    const current = selectedRef.current;
    if (current) {
      router.push(`/activity/${current.activity.id}`);
      setSelected(null);
    }
  }, [router, setSelected]);

  // Zoom to selected activity bounds - uses ref for stable callback
  const handleZoomToActivity = useCallback(() => {
    const current = selectedRef.current;
    if (!current) return;

    const normalized = normalizeBounds(current.activity.bounds);
    surfaceRef.current?.fitBounds(
      {
        sw: [normalized.minLng, normalized.minLat],
        ne: [normalized.maxLng, normalized.maxLat],
      },
      REGIONAL_FIT_PADDING,
      500
    );
  }, [surfaceRef]);

  // One tap handler for the whole surface. The page resolves which layer the
  // finger landed on, so there is no platform-specific hit test left here.
  const handleSurfacePress = useCallback(
    async (event: MapPressEvent) => {
      const feature = event.feature;

      if (!feature) {
        // Empty space: dismiss whatever is open.
        if (selectedRef.current) setSelected(null);
        setSpider(null);
        return;
      }

      if (feature.layerId === SECTIONS_LINE_LAYER_ID) {
        const sectionId = feature.properties?.id;
        const section = sections.find((s) => s.id === sectionId);
        if (section) setSelectedSection(section);
        return;
      }

      if (feature.layerId === SPIDER_POINT_LAYER_ID) {
        const activityId = feature.properties?.id;
        const activity = activities.find((a) => a.id === activityId);
        if (activity) {
          setSpider(null);
          handleMarkerTap(activity);
        }
        return;
      }

      if (feature.layerId === CLUSTER_CIRCLE_LAYER_ID) {
        // Fit the camera to the cluster's leaves. That gives a tighter, more
        // predictable zoom than the next supercluster split point.
        const clusterId = Number(feature.properties?.cluster_id);
        if (!Number.isFinite(clusterId)) return;
        const coords = (feature.geometry as GeoJSON.Point | null)?.coordinates as
          | [number, number]
          | undefined;
        if (!coords) return;

        const pointCount = Number(feature.properties?.point_count ?? 0);
        // Cap at 100 leaves - plenty for bounds computation, cheap to transfer.
        const limit = Math.max(1, Math.min(pointCount || 100, 100));
        const leaves =
          (await surfaceRef.current?.getClusterLeaves(CLUSTER_SOURCE_ID, clusterId, limit, 0)) ??
          [];

        const plan = planClusterZoom(leaves, coords);
        if (plan.kind === 'fitBounds') {
          surfaceRef.current?.fitBounds(
            { sw: plan.bounds.sw, ne: plan.bounds.ne },
            REGIONAL_FIT_PADDING,
            plan.durationMs
          );
        } else if (leaves.length > 0) {
          // Leaves are stacked on top of each other - fan out into a spider
          // pattern so each underlying activity is tappable.
          setSpider({ center: coords, leaves });
        }
        return;
      }

      if (feature.layerId === UNCLUSTERED_POINT_LAYER_ID) {
        const activityId = feature.properties?.id;
        const activity = activities.find((a) => a.id === activityId);
        if (activity) handleMarkerTap(activity);
      }
    },
    [activities, sections, handleMarkerTap, setSelected, setSelectedSection, setSpider, surfaceRef]
  );

  // Ref for spider dismissal during gestures (avoids adding setSpider to hot path deps)
  const setSpiderRef = useRef(setSpider);
  setSpiderRef.current = setSpider;
  const spiderDismissedRef = useRef(false);

  // Handle map region change to update compass (real-time during gesture)
  const handleRegionIsChanging = useCallback(
    (state: MapCameraState) => {
      bearingAnim.setValue(-state.bearing);
      currentZoomLevel.current = state.zoom;
      // Dismiss spider on first gesture frame (avoid repeated calls)
      if (!spiderDismissedRef.current) {
        spiderDismissedRef.current = true;
        setSpiderRef.current(null);
        // Reset flag after gesture settles
        setTimeout(() => {
          spiderDismissedRef.current = false;
        }, 500);
      }
    },
    [bearingAnim, currentZoomLevel]
  );

  // Handle region change end - track zoom level, center, and update visible activities.
  // Zoom and center are debounced because they drive attribution recalculation,
  // which is expensive for satellite. Visible ids are debounced separately to
  // batch rapid pan/zoom sequences.
  const handleRegionDidChange = useCallback(
    (state: MapCameraState) => {
      const { zoom, center, bounds } = state;

      // Update immediately for handlers that read it synchronously
      currentZoomLevel.current = zoom;

      if (zoomCenterDebounceRef.current) clearTimeout(zoomCenterDebounceRef.current);
      zoomCenterDebounceRef.current = setTimeout(() => {
        if (Math.abs(zoom - prevZoomRef.current) > 0.01) {
          // Check trace threshold crossing BEFORE updating prev
          const wasAbove = prevZoomRef.current >= traceZoomThreshold;
          const nowAbove = zoom >= traceZoomThreshold;
          if (wasAbove !== nowAbove) {
            setAboveTraceZoom(nowAbove);
          }
          prevZoomRef.current = zoom;
          currentZoomRef.current = zoom;
        }
        const prev = prevCenterRef.current;
        if (!prev || Math.abs(prev[0] - center[0]) > 1e-6 || Math.abs(prev[1] - center[1]) > 1e-6) {
          prevCenterRef.current = center;
          currentCenterRef.current = center;
        }

        // Persist camera position for restore on next visit (fire-and-forget)
        if (zoom > 0) {
          saveMapCameraState(center, zoom);
          onCameraSettled?.(center, zoom);
        }
      }, REGION_SETTLE_DEBOUNCE_MS);

      // Below the culling threshold the whole set is drawn: filtering costs
      // more than it saves, and the resulting state change would churn the
      // marker source on every pan.
      if (activities.length >= VIEWPORT_CULLING_THRESHOLD) {
        if (visibleDebounceRef.current) clearTimeout(visibleDebounceRef.current);
        visibleDebounceRef.current = setTimeout(() => {
          const [west, south] = bounds.sw;
          const [east, north] = bounds.ne;

          // Skip the spatial-index query when the viewport hasn't moved.
          const boundsKey = `${east.toFixed(4)},${north.toFixed(4)},${west.toFixed(4)},${south.toFixed(4)}`;
          if (boundsKey === prevBoundsKeyRef.current) return;
          prevBoundsKeyRef.current = boundsKey;

          if (activitySpatialIndex.ready) {
            const viewport = mapBoundsToViewport([west, south], [east, north]);
            const visibleIds = activitySpatialIndex.queryViewport(viewport);

            // Only update state when content actually changes - a new Set with
            // identical content would recompute the markers and post them again.
            const key =
              visibleIds.length +
              ':' +
              (visibleIds.length <= 500
                ? visibleIds.sort().join(',')
                : visibleIds.slice(0, 20).sort().join(','));
            if (key !== prevVisibleKeyRef.current) {
              prevVisibleKeyRef.current = key;
              if (visibleIds.length > 0 || activitySpatialIndex.size === 0) {
                setVisibleActivityIds(new Set(visibleIds));
              }
            }
          }
        }, REGION_CHANGE_DEBOUNCE_MS);
      }

      markUserInteracted();
    },
    [
      activities.length,
      currentZoomLevel,
      currentZoomRef,
      currentCenterRef,
      setAboveTraceZoom,
      traceZoomThreshold,
      setVisibleActivityIds,
      onCameraSettled,
      markUserInteracted,
    ]
  );

  // Cache last location to avoid slow GPS re-acquisition
  const lastLocationRef = useRef<{
    coords: [number, number];
    timestamp: number;
  } | null>(null);

  // One-time jump to user location (shows dot, no tracking)
  const handleGetLocation = useCallback(async () => {
    try {
      setLocationLoading(true);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationLoading(false);
        return;
      }

      let coords: [number, number];

      // Use cached location if recent
      const cached = lastLocationRef.current;
      const now = Date.now();
      if (cached && now - cached.timestamp < LOCATION_CACHE_MAX_AGE_MS) {
        coords = cached.coords;
      } else {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = [location.coords.longitude, location.coords.latitude];
        lastLocationRef.current = { coords, timestamp: now };
      }

      setUserLocation(coords);
      setLocationLoading(false);

      surfaceRef.current?.setCamera({ center: coords, zoom: 13 }, 500);
    } catch {
      setLocationLoading(false);
      // Silently fail - location is optional
    }
  }, [surfaceRef, setUserLocation, setLocationLoading]);

  // Toggle activities visibility - clear selection when hiding
  const toggleActivities = useCallback(() => {
    setShowActivities((current) => {
      if (current) {
        // We're hiding activities, clear selection
        setSelected(null);
      }
      return !current;
    });
  }, [setShowActivities, setSelected]);

  // Toggle sections visibility - clear selection when hiding
  const toggleSections = useCallback(() => {
    setShowSections((current) => {
      if (current) {
        // We're hiding sections, clear selection
        setSelectedSection(null);
      }
      return !current;
    });
  }, [setShowSections, setSelectedSection]);

  // Toggle routes visibility - clear selection when hiding
  const toggleRoutes = useCallback(() => {
    setShowRoutes((current) => {
      if (current) {
        // We're hiding routes, clear selection
        setSelectedRoute(null);
      }
      return !current;
    });
  }, [setShowRoutes, setSelectedRoute]);

  // Reset bearing to north (and pitch in 3D mode)
  const resetOrientation = useCallback(() => {
    if (is3DMode) {
      map3DRef.current?.resetOrientation();
    } else {
      surfaceRef.current?.resetOrientation();
    }
    Animated.timing(bearingAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [is3DMode, map3DRef, surfaceRef, bearingAnim]);

  // Fit all activities in view - recalculates bounds from all current activities
  const handleFitAll = useCallback(() => {
    if (activities.length === 0) return;

    // Calculate bounds from all activities
    // bounds format: [[minLat, minLng], [maxLat, maxLng]]
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const activity of activities) {
      const bounds = activity.bounds;
      if (bounds && Array.isArray(bounds) && bounds.length === 2) {
        const [min, max] = bounds;
        if (Array.isArray(min) && Array.isArray(max) && min.length >= 2 && max.length >= 2) {
          minLat = Math.min(minLat, min[0]);
          minLng = Math.min(minLng, min[1]);
          maxLat = Math.max(maxLat, max[0]);
          maxLng = Math.max(maxLng, max[1]);
        }
      }
    }

    // Validate bounds
    if (!Number.isFinite(minLat) || !Number.isFinite(maxLat)) return;

    surfaceRef.current?.fitBounds(
      { sw: [minLng, minLat], ne: [maxLng, maxLat] },
      REGIONAL_FIT_PADDING,
      500
    );
  }, [activities, surfaceRef]);

  return {
    handleMarkerTap,
    handleClosePopup,
    handleViewDetails,
    handleZoomToActivity,
    handleSurfacePress,
    handleRegionIsChanging,
    handleRegionDidChange,
    handleGetLocation,
    toggleActivities,
    toggleSections,
    toggleRoutes,
    resetOrientation,
    handleFitAll,
  };
}
