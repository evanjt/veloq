/**
 * Hook for RegionalMapView event handlers.
 * Extracts handler logic from the main component for better organization.
 */

import { useCallback, useRef, useEffect } from 'react';
import { Animated } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type { Camera } from '@maplibre/maplibre-react-native';
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
  handleMarkerPress: (event: { features?: GeoJSON.Feature[] }) => void;
  handleMapPress: () => void;
  handleSectionPress: (event: { features?: GeoJSON.Feature[] }) => void;
  handleHeatmapCellPress: (row: number, col: number) => void;
  handleRegionIsChanging: (feature: GeoJSON.Feature) => void;
  handleRegionDidChange: (feature: GeoJSON.Feature) => void;
  handleGetLocation: () => Promise<void>;
  toggleHeatmap: () => void;
  toggleActivities: () => void;
  toggleSections: () => void;
  toggleRoutes: () => void;
  resetOrientation: () => void;
  userLocationTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
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
  const userLocationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Handle marker tap - no auto-zoom to prevent jarring camera movements
  const handleMarkerTap = useCallback(
    async (activity: ActivityBoundsItem) => {
      // Set loading state - don't zoom, just show the popup
      setSelected({ activity, mapData: null, isLoading: true });

      try {
        // Fetch full map data (with coordinates)
        const mapData = await intervalsApi.getActivityMap(activity.id, false);
        setSelected({ activity, mapData, isLoading: false });
      } catch {
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
    const bounds = {
      ne: [normalized.maxLng, normalized.maxLat] as [number, number],
      sw: [normalized.minLng, normalized.minLat] as [number, number],
    };

    cameraRef.current?.setCamera({
      bounds,
      padding: {
        paddingTop: 100,
        paddingRight: 60,
        paddingBottom: 280,
        paddingLeft: 60,
      },
      animationDuration: 500,
    });
  }, [selected, cameraRef]);

  // Handle marker tap via ShapeSource press
  const handleMarkerPress = useCallback(
    (event: { features?: GeoJSON.Feature[] }) => {
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

  // Handle map press - close popup when tapping empty space
  const handleMapPress = useCallback(() => {
    if (selected) {
      setSelected(null);
    }
  }, [selected, setSelected]);

  // Handle section press
  const handleSectionPress = useCallback(
    (event: { features?: GeoJSON.Feature[] }) => {
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
      if (properties?.heading !== undefined) {
        bearingAnim.setValue(-properties.heading);
      }
      if (properties?.zoomLevel !== undefined) {
        currentZoomLevel.current = properties.zoomLevel;
      }
    },
    [bearingAnim, currentZoomLevel]
  );

  // Handle region change end - track zoom level, center, and update visible activities
  const handleRegionDidChange = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as
        | {
            zoomLevel?: number;
            visibleBounds?: [[number, number], [number, number]];
          }
        | undefined;

      if (properties?.zoomLevel !== undefined) {
        currentZoomLevel.current = properties.zoomLevel;
        setCurrentZoom(properties.zoomLevel);
      }

      if (properties?.visibleBounds) {
        const [[swLng, swLat], [neLng, neLat]] = properties.visibleBounds;

        // Calculate and store center from visible bounds
        const centerLng = (swLng + neLng) / 2;
        const centerLat = (swLat + neLat) / 2;
        setCurrentCenter([centerLng, centerLat]);

        if (activitySpatialIndex.ready) {
          const viewport = mapBoundsToViewport([swLng, swLat], [neLng, neLat]);
          const visibleIds = activitySpatialIndex.queryViewport(viewport);

          if (visibleIds.length > 0 || activitySpatialIndex.size === 0) {
            setVisibleActivityIds(new Set(visibleIds));
          }
        }
      }
    },
    [currentZoomLevel, setCurrentZoom, setCurrentCenter, setVisibleActivityIds]
  );

  // Get user location (one-time jump, no tracking)
  const handleGetLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords: [number, number] = [location.coords.longitude, location.coords.latitude];
      setUserLocation(coords);

      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 13,
        animationDuration: 500,
      });

      if (userLocationTimeoutRef.current) {
        clearTimeout(userLocationTimeoutRef.current);
      }

      userLocationTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setUserLocation(null);
        }
      }, 3000);
    } catch {
      // Silently fail - location is optional
    }
  }, [setUserLocation, cameraRef, isMountedRef]);

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

  // Clean up location timeout on unmount to prevent setState after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (userLocationTimeoutRef.current) {
        clearTimeout(userLocationTimeoutRef.current);
      }
    };
  }, []);

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
    userLocationTimeoutRef,
  };
}
