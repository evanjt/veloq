/**
 * Hook for RegionalMapView event handlers.
 * Extracts handler logic from the main component for better organization.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location'; // 30 seconds
import { normalizeBounds } from '@/shared/geo/polyline';
import { planClusterZoom, stackedOn } from '@/features/maps/lib/clusterZoom';
import type { LngLatBounds } from '@/features/maps/lib/coordinates';
import { sectionIdsAtTap } from '@/features/maps/lib/sectionIdsAtTap';
import { trackStillWanted, waitForGpsTrack } from '@/features/maps/lib/gpsTrackWait';
import { saveMapCameraState } from '@/features/maps/lib/storage/mapCameraState';
import { decodeCoords, DownloadPriority } from 'veloqrs';
import { present } from 'veloqrs/src/delegates/optional';
import { activityStartEpoch } from '@/shared/activity/streamWindow';
import { getEngine } from '@/shared/native/engine';
import type { ActivityBoundsItem } from '@/types';
import type { SelectedActivity } from './ActivityPopup';
import type { Map3DWebViewRef } from '../Map3DWebView';
import type { MapCameraState, MapFeatureHit, MapPressEvent, MapSurfaceRef } from '../MapSurface';
import {
  CLUSTER_SOURCE_ID,
  CLUSTER_CIRCLE_LAYER_ID,
  SECTIONS_LINE_LAYER_ID,
  SPIDER_POINT_LAYER_ID,
  UNCLUSTERED_POINT_LAYER_ID,
} from './regionalMapLayerSpecs';
import { REGIONAL_FIT_PADDING } from './regionalCamera';
import { REGION_SETTLE_DEBOUNCE_MS } from '@/features/maps/lib/mapBudgets';
// Cache for last known location (avoid slow GPS re-acquisition)
const LOCATION_CACHE_MAX_AGE_MS = 30000;

/** The ease onto a cluster whose leaves never arrived. */
const CLUSTER_EXPAND_DURATION_MS = 400;

/** Points no zoom will pull apart, fanned out: a cluster at max zoom, or stacked starts. */
export interface SpiderState {
  center: [number, number]; // [lng, lat]
  leaves: GeoJSON.Feature[]; // one activity feature each, carrying its id and colour
}

interface UseMapHandlersOptions {
  activities: ActivityBoundsItem[];
  selected: SelectedActivity | null;
  setSelected: (value: SelectedActivity | null) => void;
  setSelectedSectionId: (value: string | null) => void;
  setSectionChoices: (value: string[]) => void;
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
  currentZoomRef: React.MutableRefObject<number>;
  currentCenterRef: React.MutableRefObject<[number, number] | null>;
  onCameraSettled?: (center: [number, number], zoom: number, bounds?: LngLatBounds) => void;
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
  /** Open the popup for an activity and bring its bounds on screen. */
  handleFocusActivity: (activity: ActivityBoundsItem) => void;
  /** Single tap entry point. The page has already resolved which layer was hit. */
  handleSurfacePress: (event: MapPressEvent) => void;
  /** A tap on bare terrain, shared by the 2D surface and the 3D page. */
  handleEmptyPress: () => void;
  handleRegionIsChanging: (state: MapCameraState) => void;
  handleRegionDidChange: (state: MapCameraState) => void;
  handleGetLocation: () => Promise<void>;
  toggleActivities: () => void;
  toggleSections: () => void;
  toggleRoutes: () => void;
  resetOrientation: () => void;
  handleFitAll: () => void;
}

function asPointFeature(hit: MapFeatureHit): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: hit.properties,
    geometry: hit.geometry as GeoJSON.Geometry,
  };
}

export function useMapHandlers({
  activities,
  selected,
  setSelected,
  setSelectedSectionId,
  setSectionChoices,
  setShowActivities,
  setShowSections,
  setShowRoutes,
  setSelectedRoute,
  setUserLocation,
  setLocationLoading,
  currentZoomRef,
  currentCenterRef,
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

  // The 2D surface is unmounted while 3D shows, so a camera move has to go to
  // whichever of the two is on screen.
  const cameraTarget = useCallback(
    () => (is3DMode ? map3DRef.current : surfaceRef.current),
    [is3DMode, map3DRef, surfaceRef]
  );

  // Ref to access current selected without adding it as callback dependency
  // This keeps callbacks stable for React.memo optimization
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Debounce timers for region change handlers
  const zoomCenterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track previous center/zoom to skip redundant ref updates and threshold checks
  const prevCenterRef = useRef<[number, number] | null>(null);
  const prevZoomRef = useRef<number>(-1);

  // Read by the track wait, which outlives this screen by up to fifteen
  // seconds and must not write into it once it has gone.
  const mountedRef = useRef(true);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
        const engine = getEngine();
        const encoded = engine?.getGpsTrack(activity.id);
        const localTrack = encoded ? decodeCoords(encoded) : [];

        if (localTrack.length > 0) {
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
          //
          // The run id is discarded on purpose: this caller waits for the
          // track to appear in the engine rather than for the fetch's own
          // result, so its result is never read. It is filed under its own run
          // and evicted in turn, which is what stops it being handed to the
          // sync or the push task as theirs.
          getEngine()?.startFetchAndStore(
            [activity.id],
            [
              present({
                activityId: activity.id,
                sportType: activity.type,
                startDate: activityStartEpoch(activity.date),
              }),
            ],
            // Somebody is looking at this one, so it goes out beside a bulk
            // pass rather than behind its hundreds.
            DownloadPriority.Interactive
          );
          setSelected({ activity, mapData: null, isLoading: true });
          waitForGpsTrack(activity.id).then((coords) => {
            // The wait is up to fifteen seconds, so what the athlete is
            // looking at now decides whether this lands.
            const onScreen = selectedRef.current?.activity.id ?? null;
            if (!trackStillWanted(activity.id, onScreen, mountedRef.current)) return;
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

  const fitToActivity = useCallback(
    (activity: ActivityBoundsItem) => {
      const normalized = normalizeBounds(activity.bounds);
      cameraTarget()?.fitBounds(
        {
          sw: [normalized.minLng, normalized.minLat],
          ne: [normalized.maxLng, normalized.maxLat],
        },
        REGIONAL_FIT_PADDING,
        500
      );
    },
    [cameraTarget]
  );

  // Zoom to selected activity bounds - uses ref for stable callback
  const handleZoomToActivity = useCallback(() => {
    const current = selectedRef.current;
    if (current) fitToActivity(current.activity);
  }, [fitToActivity]);

  const handleFocusActivity = useCallback(
    (activity: ActivityBoundsItem) => {
      handleMarkerTap(activity);
      fitToActivity(activity);
    },
    [handleMarkerTap, fitToActivity]
  );

  const handleEmptyPress = useCallback(() => {
    if (selectedRef.current) setSelected(null);
    setSelectedSectionId(null);
    setSectionChoices([]);
    setSpider(null);
  }, [setSelected, setSelectedSectionId, setSectionChoices, setSpider]);

  // One tap handler for the whole surface. The page resolves which layer the
  // finger landed on, so there is no platform-specific hit test left here.
  const handleSurfacePress = useCallback(
    async (event: MapPressEvent) => {
      const feature = event.feature;

      if (!feature) {
        handleEmptyPress();
        return;
      }

      if (feature.layerId === SECTIONS_LINE_LAYER_ID) {
        const ids = sectionIdsAtTap(event.features?.length ? event.features : [feature]);
        setSectionChoices(ids.length > 1 ? ids : []);
        if (ids.length === 1) setSelectedSectionId(ids[0] ?? null);
        if (ids.length > 1) setSelectedSectionId(null);
        return;
      }

      setSectionChoices([]);

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
        } else if (plan.kind === 'stacked') {
          // Leaves are stacked on top of each other - fan out into a spider
          // pattern so each underlying activity is tappable.
          setSpider({ center: coords, leaves });
        } else {
          // No leaves came back, and the page says nothing about why. Ask
          // supercluster where this cluster splits and go there, so the tap is
          // never a tap that did nothing. A split zoom it cannot give either
          // leaves the camera centred on the cluster, which still moves.
          const splitZoom = await surfaceRef.current?.getClusterExpansionZoom(
            CLUSTER_SOURCE_ID,
            clusterId
          );
          surfaceRef.current?.setCamera(
            {
              center: coords,
              zoom: Number.isFinite(splitZoom) ? (splitZoom as number) : undefined,
            },
            CLUSTER_EXPAND_DURATION_MS
          );
        }
        return;
      }

      if (feature.layerId === UNCLUSTERED_POINT_LAYER_ID) {
        // Starts no zoom will pull apart, thirty rides from one garage, fan out.
        const hits = event.features && event.features.length > 0 ? event.features : [feature];
        const stacked = stackedOn(hits.map(asPointFeature));
        if (stacked.length > 1) {
          setSpider({
            center: (stacked[0].geometry as GeoJSON.Point).coordinates as [number, number],
            leaves: stacked,
          });
          return;
        }
      }

      if (feature.layerId === UNCLUSTERED_POINT_LAYER_ID) {
        const activityId = feature.properties?.id;
        const activity = activities.find((a) => a.id === activityId);
        if (activity) handleMarkerTap(activity);
      }
    },
    [
      activities,
      handleEmptyPress,
      handleMarkerTap,
      setSelectedSectionId,
      setSectionChoices,
      setSpider,
      surfaceRef,
    ]
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

  // Handle region change end - track zoom level and center.
  // Zoom and center are debounced because they drive attribution recalculation,
  // which is expensive for satellite.
  const handleRegionDidChange = useCallback(
    (state: MapCameraState) => {
      const { zoom, center, bounds } = state;

      // Update immediately for handlers that read it synchronously
      currentZoomLevel.current = zoom;

      if (zoomCenterDebounceRef.current) clearTimeout(zoomCenterDebounceRef.current);
      zoomCenterDebounceRef.current = setTimeout(() => {
        if (Math.abs(zoom - prevZoomRef.current) > 0.01) {
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
          onCameraSettled?.(center, zoom, bounds);
        }
      }, REGION_SETTLE_DEBOUNCE_MS);

      markUserInteracted();
    },
    [currentZoomLevel, currentZoomRef, currentCenterRef, onCameraSettled, markUserInteracted]
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

      cameraTarget()?.setCamera({ center: coords, zoom: 13 }, 500);
    } catch {
      setLocationLoading(false);
      // Silently fail - location is optional
    }
  }, [cameraTarget, setUserLocation, setLocationLoading]);

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
        setSelectedSectionId(null);
        setSectionChoices([]);
      }
      return !current;
    });
  }, [setShowSections, setSelectedSectionId, setSectionChoices]);

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

    cameraTarget()?.fitBounds(
      { sw: [minLng, minLat], ne: [maxLng, maxLat] },
      REGIONAL_FIT_PADDING,
      500
    );
  }, [activities, cameraTarget]);

  return {
    handleMarkerTap,
    handleClosePopup,
    handleViewDetails,
    handleZoomToActivity,
    handleFocusActivity,
    handleSurfacePress,
    handleEmptyPress,
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
