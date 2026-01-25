/**
 * Hook for RegionalMapView event handlers.
 * Extracts handler logic from the main component for better organization.
 */

import { useCallback, useRef } from 'react';
import { Animated } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type { Camera, OnPressEvent } from '@maplibre/maplibre-react-native';
import { LocationManager } from '@maplibre/maplibre-react-native';

// Cache for last known location (avoid slow GPS re-acquisition)
const LOCATION_CACHE_MAX_AGE_MS = 30000; // 30 seconds
import { normalizeBounds, activitySpatialIndex, mapBoundsToViewport } from '@/lib';
import { intervalsApi } from '@/api';
import type { ActivityBoundsItem } from '@/types';
import type { FrequentSection } from '@/types';
import type { SelectedActivity } from './ActivityPopup';
import type { CellQueryResult, HeatmapResult } from '@/hooks/useHeatmap';
import type { Map3DWebViewRef } from '../Map3DWebView';

interface UseMapHandlersOptions {
  activities: ActivityBoundsItem[];
  sections: FrequentSection[];
  heatmap: HeatmapResult | null;
  queryCell: (lat: number, lng: number) => CellQueryResult | null;
  selected: SelectedActivity | null;
  setSelected: (value: SelectedActivity | null) => void;
  isHeatmapMode: boolean;
  setIsHeatmapMode: (value: boolean | ((prev: boolean) => boolean)) => void;
  setSelectedCell: (value: CellQueryResult | null) => void;
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
  setVisibleActivityIds: (value: Set<string> | null) => void;
  setCurrentZoom: (value: number) => void;
  setCurrentCenter: (value: [number, number] | null) => void;
  cameraRef: React.RefObject<React.ElementRef<typeof Camera> | null>;
  map3DRef: React.RefObject<Map3DWebViewRef | null>;
  bearingAnim: Animated.Value;
  currentZoomLevel: React.MutableRefObject<number>;
  is3DMode: boolean;
}

interface UseMapHandlersResult {
  handleMarkerTap: (activity: ActivityBoundsItem) => Promise<void>;
  handleClosePopup: () => void;
  handleViewDetails: () => void;
  handleZoomToActivity: () => void;
  handleMarkerPress: (event: OnPressEvent) => void;
  handleMapPress: () => void;
  handleSectionPress: (event: OnPressEvent) => void;
  handleHeatmapCellPress: (row: number, col: number) => void;
  handleRegionIsChanging: (feature: GeoJSON.Feature) => void;
  handleRegionDidChange: (feature: GeoJSON.Feature) => void;
  handleGetLocation: () => Promise<void>;
  toggleHeatmap: () => void;
  toggleActivities: () => void;
  toggleSections: () => void;
  toggleRoutes: () => void;
  resetOrientation: () => void;
  handleFitAll: () => void;
}

export function useMapHandlers({
  activities,
  sections,
  heatmap,
  queryCell,
  selected,
  setSelected,
  isHeatmapMode,
  setIsHeatmapMode,
  setSelectedCell,
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
  setVisibleActivityIds,
  setCurrentZoom,
  setCurrentCenter,
  cameraRef,
  map3DRef,
  bearingAnim,
  currentZoomLevel,
  is3DMode,
}: UseMapHandlersOptions): UseMapHandlersResult {
  const router = useRouter();

  // Handle marker tap - no auto-zoom to prevent jarring camera movements
  const handleMarkerTap = useCallback(
    async (activity: ActivityBoundsItem) => {
      console.log('[handleMarkerTap] tapped activity:', activity.id);
      // Set loading state - don't zoom, just show the popup
      setSelected({ activity, mapData: null, isLoading: true });

      try {
        // Fetch full map data (with coordinates)
        const mapData = await intervalsApi.getActivityMap(activity.id, false);
        console.log('[handleMarkerTap] mapData received:', {
          hasLatlngs: !!mapData?.latlngs,
          latlngsLength: mapData?.latlngs?.length,
        });
        setSelected({ activity, mapData, isLoading: false });
      } catch (err) {
        console.log('[handleMarkerTap] error fetching mapData:', err);
        setSelected({ activity, mapData: null, isLoading: false });
      }
    },
    [setSelected]
  );

  // Close popup
  const handleClosePopup = useCallback(() => {
    setSelected(null);
  }, [setSelected]);

  // Navigate to activity detail
  const handleViewDetails = useCallback(() => {
    if (selected) {
      router.push(`/activity/${selected.activity.id}`);
      setSelected(null);
    }
  }, [selected, router, setSelected]);

  // Zoom to selected activity bounds
  const handleZoomToActivity = useCallback(() => {
    if (!selected) return;

    const normalized = normalizeBounds(selected.activity.bounds);
    const ne: [number, number] = [normalized.maxLng, normalized.maxLat];
    const sw: [number, number] = [normalized.minLng, normalized.minLat];

    cameraRef.current?.fitBounds(
      ne,
      sw,
      [100, 60, 280, 60], // [top, right, bottom, left]
      500
    );
  }, [selected, cameraRef]);

  // Handle marker tap via ShapeSource press (Android only)
  const handleMarkerPress = useCallback(
    (event: OnPressEvent) => {
      const feature = event.features?.[0];
      if (!feature?.properties?.id) return;

      const activityId = feature.properties.id;
      const activity = activities.find((a) => a.id === activityId);
      if (activity) {
        handleMarkerTap(activity);
      }
    },
    [activities, handleMarkerTap]
  );

  // Handle map press - Android only (iOS uses onTouchEnd on container View)
  // GeoJSONSource.onPress doesn't fire on iOS with new architecture (Fabric)
  const handleMapPress = useCallback(
    (_feature?: GeoJSON.Feature) => {
      // Close popup if tapped on empty space
      if (selected) {
        setSelected(null);
      }
    },
    [selected, setSelected]
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

  // Handle heatmap cell press
  const handleHeatmapCellPress = useCallback(
    (row: number, col: number) => {
      if (!heatmap) return;
      const cell = heatmap.cells.find((c) => c.row === row && c.col === col);
      if (cell) {
        const result = queryCell(cell.centerLat, cell.centerLng);
        setSelectedCell(result);
      }
    },
    [heatmap, queryCell, setSelectedCell]
  );

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
    },
    [bearingAnim, currentZoomLevel]
  );

  // Handle region change end - track zoom level, center, and update visible activities
  const handleRegionDidChange = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as
        | { zoomLevel?: number; visibleBounds?: [[number, number], [number, number]] }
        | undefined;
      const { zoomLevel, visibleBounds } = properties ?? {};
      const center =
        feature.geometry?.type === 'Point'
          ? (feature.geometry.coordinates as [number, number])
          : undefined;

      if (zoomLevel !== undefined) {
        currentZoomLevel.current = zoomLevel;
        setCurrentZoom(zoomLevel);
      }

      // v10: center is from feature.geometry.coordinates [lng, lat]
      if (center) {
        setCurrentCenter(center);
      }

      // v10: visibleBounds is [northEast, southWest] where each is [lng, lat]
      if (visibleBounds) {
        const [northEast, southWest] = visibleBounds;
        const [east, north] = northEast;
        const [west, south] = southWest;

        if (activitySpatialIndex.ready) {
          const viewport = mapBoundsToViewport([west, south], [east, north]);
          const visibleIds = activitySpatialIndex.queryViewport(viewport);

          if (visibleIds.length > 0 || activitySpatialIndex.size === 0) {
            setVisibleActivityIds(new Set(visibleIds));
          }
        }
      }
    },
    [currentZoomLevel, setCurrentZoom, setCurrentCenter, setVisibleActivityIds]
  );

  // Cache last location to avoid slow GPS re-acquisition
  const lastLocationRef = useRef<{ coords: [number, number]; timestamp: number } | null>(null);

  // One-time jump to user location (shows dot, no tracking)
  // Each press gets location, shows dot, centers map once
  const handleGetLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
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
      // Silently fail - location is optional
    }
  }, [cameraRef, setUserLocation]);

  // Toggle heatmap mode
  const toggleHeatmap = useCallback(() => {
    setIsHeatmapMode((current) => !current);
    if (!isHeatmapMode) {
      setSelected(null);
    }
    if (isHeatmapMode) {
      setSelectedCell(null);
    }
  }, [isHeatmapMode, setIsHeatmapMode, setSelected, setSelectedCell]);

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
  }, [activities, cameraRef]);

  return {
    handleMarkerTap,
    handleClosePopup,
    handleViewDetails,
    handleZoomToActivity,
    handleMarkerPress,
    handleMapPress,
    handleSectionPress,
    handleHeatmapCellPress,
    handleRegionIsChanging,
    handleRegionDidChange,
    handleGetLocation,
    toggleHeatmap,
    toggleActivities,
    toggleSections,
    toggleRoutes,
    resetOrientation,
    handleFitAll,
  };
}
