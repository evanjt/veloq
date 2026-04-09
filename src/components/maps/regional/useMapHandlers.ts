/**
 * Hook for RegionalMapView event handlers.
 * Extracts handler logic from the main component for better organization.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type { Camera, OnPressEvent, ShapeSource } from '@maplibre/maplibre-react-native';
import { LocationManager } from '@maplibre/maplibre-react-native';

// Cache for last known location (avoid slow GPS re-acquisition)
const LOCATION_CACHE_MAX_AGE_MS = 30000; // 30 seconds
import { normalizeBounds, activitySpatialIndex, mapBoundsToViewport } from '@/lib';
import { saveMapCameraState } from '@/lib/storage/mapCameraState';
import { intervalsApi } from '@/api';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { ActivityBoundsItem } from '@/types';
import type { FrequentSection } from '@/types';
import type { SelectedActivity } from './ActivityPopup';
import type { Map3DWebViewRef } from '../Map3DWebView';

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
  cameraRef: React.RefObject<React.ElementRef<typeof Camera> | null>;
  clusterSourceRef: React.RefObject<React.ElementRef<typeof ShapeSource> | null>;
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
  handleClusterOrMarkerPress: (event: OnPressEvent) => void;
  handleSpiderMarkerPress: (event: OnPressEvent) => void;
  handleMapPress: () => void;
  handleSectionPress: (event: OnPressEvent) => void;
  handleRegionIsChanging: (feature: GeoJSON.Feature) => void;
  handleRegionDidChange: (feature: GeoJSON.Feature) => void;
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
  showActivities,
  setShowActivities,
  showSections,
  setShowSections,
  showRoutes,
  setShowRoutes,
  setSelectedRoute,
  userLocation,
  setUserLocation,
  setLocationLoading,
  setVisibleActivityIds,
  currentZoomRef,
  currentCenterRef,
  setAboveTraceZoom,
  traceZoomThreshold,
  onCameraSettled,
  cameraRef,
  clusterSourceRef,
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
          // Fallback to API if local data not available
          intervalsApi
            .getActivityMap(activity.id, false)
            .then((mapData) => {
              setSelected({ activity, mapData, isLoading: false });
            })
            .catch(() => {
              setSelected({ activity, mapData: null, isLoading: false });
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
    const ne: [number, number] = [normalized.maxLng, normalized.maxLat];
    const sw: [number, number] = [normalized.minLng, normalized.minLat];

    cameraRef.current?.fitBounds(
      ne,
      sw,
      [100, 60, 280, 60], // [top, right, bottom, left]
      500
    );

    // Release camera from fitBounds tracking state after animation completes
    // Without this, MapLibre may keep snapping back to the bounds
    setTimeout(() => {
      cameraRef.current?.setCamera({
        animationDuration: 0,
        animationMode: 'moveTo',
      });
    }, 600);
  }, [cameraRef]);

  // Handle cluster or individual marker tap via ShapeSource press (Android only)
  const handleClusterOrMarkerPress = useCallback(
    async (event: OnPressEvent) => {
      const feature = event.features?.[0];
      if (!feature) return;

      // Cluster tap — zoom in or spider-expand at max zoom
      if (feature.properties?.cluster === true) {
        try {
          if (clusterSourceRef.current) {
            const expansionZoom = await clusterSourceRef.current.getClusterExpansionZoom(feature);
            const currentZoom = currentZoomRef.current;
            const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

            // At max zoom (can't expand further), fan out into spider pattern
            if (expansionZoom >= 17 || currentZoom >= 16) {
              const pointCount = feature.properties?.point_count ?? 0;
              const leaves = await clusterSourceRef.current.getClusterLeaves(
                feature,
                Math.min(pointCount, 50),
                0
              );
              if (leaves.features.length > 0) {
                setSpider({ center: coords, leaves: leaves.features });
              }
              return;
            }

            cameraRef.current?.setCamera({
              centerCoordinate: coords,
              zoomLevel: expansionZoom,
              animationDuration: 400,
              animationMode: 'flyTo',
            });
          }
        } catch (e) {
          if (__DEV__) console.warn('[cluster] Error handling cluster tap:', e);
        }
        return;
      }

      // Individual marker tap
      const activityId = feature.properties?.id;
      if (!activityId) return;
      const activity = activities.find((a) => a.id === activityId);
      if (activity) {
        handleMarkerTap(activity);
      }
    },
    [activities, handleMarkerTap, clusterSourceRef, cameraRef, currentZoomRef, setSpider]
  );

  // Handle tap on a spider-expanded marker (Android only)
  const handleSpiderMarkerPress = useCallback(
    (event: OnPressEvent) => {
      const feature = event.features?.[0];
      if (!feature) return;

      const activityId = feature.properties?.id;
      if (!activityId) return;
      const activity = activities.find((a) => a.id === activityId);
      if (activity) {
        setSpider(null);
        handleMarkerTap(activity);
      }
    },
    [activities, handleMarkerTap, setSpider]
  );

  // Handle map press - Android only (iOS uses onTouchEnd on container View)
  // GeoJSONSource.onPress doesn't fire on iOS with new architecture (Fabric)
  const handleMapPress = useCallback(
    (_feature?: GeoJSON.Feature) => {
      // Close popup if tapped on empty space
      if (selected) {
        setSelected(null);
      }
      // Dismiss spider on any map tap
      setSpider(null);
    },
    [selected, setSelected, setSpider]
  );

  // Handle section press
  const handleSectionPress = useCallback(
    (event: OnPressEvent) => {
      const feature = event.features?.[0];
      if (!feature?.properties?.id) return;

      const sectionId = feature.properties.id;
      const section = sections.find((s) => s.id === sectionId);
      if (section) {
        setSelectedSection(section);
      }
    },
    [sections, setSelectedSection]
  );

  // Ref for spider dismissal during gestures (avoids adding setSpider to hot path deps)
  const setSpiderRef = useRef(setSpider);
  setSpiderRef.current = setSpider;
  const spiderDismissedRef = useRef(false);

  // Handle map region change to update compass (real-time during gesture)
  const handleRegionIsChanging = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as { heading?: number; zoomLevel?: number } | undefined;
      const { heading, zoomLevel } = properties ?? {};
      if (heading !== undefined) {
        bearingAnim.setValue(-heading);
      }
      if (zoomLevel !== undefined) {
        currentZoomLevel.current = zoomLevel;
      }
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

  // Handle region change end - track zoom level, center, and update visible activities
  // Zoom/center are debounced (drives attribution recalculation which is expensive for satellite)
  // Visible activity IDs are debounced to batch rapid pan/zoom sequences
  const handleRegionDidChange = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as
        | {
            zoomLevel?: number;
            visibleBounds?: [[number, number], [number, number]];
          }
        | undefined;
      const { zoomLevel, visibleBounds } = properties ?? {};
      const center =
        feature.geometry?.type === 'Point'
          ? (feature.geometry.coordinates as [number, number])
          : undefined;

      // Always update ref immediately for other handlers that read it synchronously
      if (zoomLevel !== undefined) {
        currentZoomLevel.current = zoomLevel;
      }

      // Update zoom/center refs directly — no React state, no re-renders during gestures.
      // State updates from regionDidChange cause React re-renders that disrupt MapLibre
      // gesture handling on Android, causing camera snap-back.
      if (zoomCenterDebounceRef.current) clearTimeout(zoomCenterDebounceRef.current);
      zoomCenterDebounceRef.current = setTimeout(() => {
        if (zoomLevel !== undefined && Math.abs(zoomLevel - prevZoomRef.current) > 0.01) {
          // Check trace threshold crossing BEFORE updating prev
          const wasAbove = prevZoomRef.current >= traceZoomThreshold;
          const nowAbove = zoomLevel >= traceZoomThreshold;
          if (wasAbove !== nowAbove) {
            setAboveTraceZoom(nowAbove);
          }
          prevZoomRef.current = zoomLevel;
          currentZoomRef.current = zoomLevel;
        }
        if (center) {
          const prev = prevCenterRef.current;
          if (
            !prev ||
            Math.abs(prev[0] - center[0]) > 1e-6 ||
            Math.abs(prev[1] - center[1]) > 1e-6
          ) {
            prevCenterRef.current = center;
            currentCenterRef.current = center;
          }
        }

        // Persist camera position for restore on next visit (fire-and-forget)
        const finalZoom = zoomLevel ?? prevZoomRef.current;
        const finalCenter = center ?? prevCenterRef.current;
        if (finalCenter && finalZoom > 0) {
          saveMapCameraState(finalCenter, finalZoom);
          onCameraSettled?.(finalCenter, finalZoom);
        }
      }, 300);

      // v10: visibleBounds is [northEast, southWest] where each is [lng, lat]
      if (visibleBounds) {
        if (visibleDebounceRef.current) clearTimeout(visibleDebounceRef.current);
        visibleDebounceRef.current = setTimeout(() => {
          const [northEast, southWest] = visibleBounds;
          const [east, north] = northEast;
          const [west, south] = southWest;

          // Skip FFI queryViewport entirely when the viewport hasn't changed.
          // On Android, MapLibre can fire spurious regionDidChange after React re-renders;
          // this guard prevents unnecessary FFI calls in that case.
          const boundsKey = `${east.toFixed(4)},${north.toFixed(4)},${west.toFixed(4)},${south.toFixed(4)}`;
          if (boundsKey === prevBoundsKeyRef.current) return;
          prevBoundsKeyRef.current = boundsKey;

          if (activitySpatialIndex.ready) {
            const viewport = mapBoundsToViewport([west, south], [east, north]);
            const visibleIds = activitySpatialIndex.queryViewport(viewport);

            // Only update state when content actually changes — creating a new Set
            // with identical content triggers useMemo recomputation → marker re-render
            // → another regionDidChange, causing an infinite loop at wide zoom levels
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
        }, 200);
      }

      markUserInteracted();
    },
    [
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
  // Each press gets location, shows dot, centers map once
  const handleGetLocation = useCallback(async () => {
    try {
      setLocationLoading(true);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationLoading(false);
        return;
      }

      let coords: [number, number];

      // Use cached location if recent (within 30 seconds)
      const cached = lastLocationRef.current;
      const now = Date.now();
      if (cached && now - cached.timestamp < LOCATION_CACHE_MAX_AGE_MS) {
        coords = cached.coords;
      } else {
        // Get fresh location
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = [location.coords.longitude, location.coords.latitude];
        // Cache it
        lastLocationRef.current = { coords, timestamp: now };
      }

      // Show the dot at user's location
      setUserLocation(coords);
      setLocationLoading(false);

      // Center map on location (one-time, no tracking)
      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 13,
        animationDuration: 500,
        animationMode: 'moveTo',
      });

      // After animation, stop any native tracking (but keep dot visible)
      setTimeout(() => {
        try {
          LocationManager.stop();
        } catch {
          // Ignore
        }
        cameraRef.current?.setCamera({
          animationDuration: 0,
          animationMode: 'moveTo',
        });
      }, 600);
    } catch {
      setLocationLoading(false);
      // Silently fail - location is optional
    }
  }, [cameraRef, setUserLocation, setLocationLoading]);

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
      cameraRef.current?.setCamera({
        heading: 0,
        animationDuration: 300,
      });
    }
    Animated.timing(bearingAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [is3DMode, map3DRef, cameraRef, bearingAnim]);

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

    // v10 API: fitBounds(ne, sw, padding, duration)
    const ne: [number, number] = [maxLng, maxLat];
    const sw: [number, number] = [minLng, minLat];

    cameraRef.current?.fitBounds(
      ne,
      sw,
      [100, 60, 280, 60], // [top, right, bottom, left]
      500
    );

    // Release camera from fitBounds tracking state after animation completes
    // Without this, MapLibre keeps snapping back to the bounds on user interaction
    setTimeout(() => {
      cameraRef.current?.setCamera({
        animationDuration: 0,
        animationMode: 'moveTo',
      });
    }, 600);
  }, [activities, cameraRef]);

  return {
    handleMarkerTap,
    handleClosePopup,
    handleViewDetails,
    handleZoomToActivity,
    handleClusterOrMarkerPress,
    handleSpiderMarkerPress,
    handleMapPress,
    handleSectionPress,
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
