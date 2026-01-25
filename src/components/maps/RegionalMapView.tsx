import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  NativeSyntheticEvent,
} from 'react-native';
import type { PressEventWithFeatures } from '@maplibre/maplibre-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/hooks';
import {
  MapView,
  Camera,
  MarkerView,
  PointAnnotation,
  ShapeSource,
  LineLayer,
  CircleLayer,
  type MapViewRef,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { convertLatLngTuples, normalizeBounds, getBoundsCenter } from '@/lib';
import { getActivityTypeConfig } from './ActivityTypeFilter';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import {
  type MapStyleType,
  getMapStyle,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
  MAP_ATTRIBUTIONS,
  TERRAIN_ATTRIBUTION,
  getCombinedSatelliteAttribution,
} from './mapStyles';
import type { ActivityBoundsItem } from '@/types';
import { HeatmapLayer } from './HeatmapLayer';
import { useHeatmap, type CellQueryResult } from '@/hooks/useHeatmap';
import { useEngineSections, useRouteSignatures, useRouteGroups } from '@/hooks/routes';
import type { FrequentSection, ActivityType } from '@/types';
import {
  ActivityPopup,
  HeatmapCellInfo,
  SectionPopup,
  RoutePopup,
  MapControlStack,
  getMarkerSize,
  useMapHandlers,
  type SelectedActivity,
} from './regional';

/**
 * 120Hz OPTIMIZATION SUMMARY:
 *
 * This component has been optimized for smooth 120fps pan/zoom by:
 *
 * 1. Pre-computed centers: Activity centers are computed once in a useMemo
 *    (using Rust-computed centers from RouteSignature when available),
 *    avoiding getBoundsCenter() format detection during render.
 *
 * 2. Stable GeoJSON: markersGeoJSON and tracesGeoJSON no longer depend on
 *    selection state. Instead, MapLibre expressions use selectedActivityId
 *    directly, preventing GeoJSON rebuilds on selection change.
 *
 * 3. Efficient sorting: sortedVisibleActivities skips sorting when no
 *    selection, and uses stable ID comparison.
 *
 * 4. Viewport culling: Uses spatial index (R-tree) to filter activities
 *    to only those in current viewport before rendering.
 */
interface RegionalMapViewProps {
  /** Activities to display */
  activities: ActivityBoundsItem[];
  /** Callback to go back */
  onClose: () => void;
  /** Extra bottom offset for attribution (e.g., when timeline slider is shown) */
  attributionBottomOffset?: number;
  /** Show attribution (default: true) */
  showAttribution?: boolean;
  /** Callback when attribution text changes */
  onAttributionChange?: (attribution: string) => void;
}

export function RegionalMapView({
  activities,
  onClose,
  attributionBottomOffset = 0,
  showAttribution = true,
  onAttributionChange,
}: RegionalMapViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isDark: systemIsDark } = useTheme();
  const [showActivities, setShowActivities] = useState(true);
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = systemIsDark ? 'dark' : 'light';
  const [mapStyle, setMapStyle] = useState<MapStyleType>(systemStyle);
  const [selected, setSelected] = useState<SelectedActivity | null>(null);
  const [is3DMode, setIs3DMode] = useState(false);
  const [isHeatmapMode, setIsHeatmapMode] = useState(false);
  const [showSections, setShowSections] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [visibleActivityIds, setVisibleActivityIds] = useState<Set<string> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(10);
  const [currentCenter, setCurrentCenter] = useState<[number, number] | null>(null);
  const [selectedCell, setSelectedCell] = useState<CellQueryResult | null>(null);
  const [selectedSection, setSelectedSection] = useState<FrequentSection | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<{
    id: string;
    name: string;
    activityCount: number;
    sportType: string;
    type: ActivityType;
    bestTime?: number;
  } | null>(null);
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);

  // iOS simulator tile loading retry mechanism
  const [mapKey, setMapKey] = useState(0);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  // Track when map is fully rendered - needed for MarkerView positioning on Android
  // v11 has a race condition where coordinates aren't applied if set before map is ready
  const [mapFullyRendered, setMapFullyRendered] = useState(false);

  const handleMapLoadError = useCallback(() => {
    if (Platform.OS === 'ios' && retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current += 1;
      console.log(
        `[RegionalMap] Load failed, retrying (${retryCountRef.current}/${MAX_RETRIES})...`
      );
      setTimeout(() => {
        setMapKey((k) => k + 1);
      }, RETRY_DELAY_MS * retryCountRef.current);
    }
  }, []);

  // Reset retry count and map rendered state when style changes
  useEffect(() => {
    retryCountRef.current = 0;
    setMapFullyRendered(false);
  }, [mapStyle, mapKey]);

  // Get route signatures from Rust engine for trace rendering
  const routeSignatures = useRouteSignatures();

  // Heatmap data from route matching cache
  const { heatmap, queryCell } = useHeatmap();

  // Frequent sections from route matching (with polylines loaded)
  // useEngineSections loads full section data from Rust engine including polylines
  // This fixes iOS crash when sectionsGeoJSON creates LineString with empty coordinates
  const { sections } = useEngineSections({ minVisits: 2 });

  // Route groups for displaying routes on the map
  const { groups: routeGroups } = useRouteGroups({ minActivities: 2 });

  // ===========================================
  // 120HZ OPTIMIZATION: Pre-compute and cache activity centers
  // ===========================================
  // Uses centers from RouteSignature when available (already computed in Rust)
  // Falls back to computing from bounds for activities without signatures
  // This avoids calling getBoundsCenter() (which does format detection) during render
  const activityCenters = useMemo(() => {
    const centers: Record<string, [number, number]> = {};
    let fromSignature = 0;
    let fromBounds = 0;

    for (const activity of activities) {
      // Try to use pre-computed center from RouteSignature (computed in Rust)
      const signature = routeSignatures[activity.id];
      if (signature?.center) {
        centers[activity.id] = [signature.center.lng, signature.center.lat];
        fromSignature++;
      } else {
        // Fallback: compute from bounds (only for activities without signatures)
        centers[activity.id] = getBoundsCenter(activity.bounds);
        fromBounds++;
      }
    }

    // DEBUG: Log first few centers to diagnose positioning issue
    if (__DEV__ && activities.length > 0) {
      const first3 = activities.slice(0, 3);
      console.log('[RegionalMapView] Activity centers debug:');
      for (const a of first3) {
        const center = centers[a.id];
        const sig = routeSignatures[a.id];
        console.log(
          `  ${a.id}: center=[${center[0].toFixed(4)}, ${center[1].toFixed(4)}] (lng, lat)`,
          {
            fromSignature: !!sig?.center,
            bounds: a.bounds,
            sigCenter: sig?.center,
          }
        );
      }
      console.log(`  Sources: ${fromSignature} from signature, ${fromBounds} from bounds`);
    }

    return centers;
  }, [activities, routeSignatures]);

  // Show GPS traces when zoomed in past this level
  const TRACE_ZOOM_THRESHOLD = 11;
  const mapRef = useRef<React.ElementRef<typeof MapView>>(null);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const bearingAnim = useRef(new Animated.Value(0)).current;
  const initialBoundsRef = useRef<{
    bounds: { ne: [number, number]; sw: [number, number] };
    center: [number, number];
    zoomLevel: number;
  } | null>(null);

  // ===========================================
  // GESTURE TRACKING - For compass updates
  // ===========================================
  // Note: Touch interception is NO LONGER AN ISSUE because we use native CircleLayer
  // instead of React Pressable. CircleLayer doesn't capture touches - it only responds
  // to taps AFTER the map's gesture system has processed them.
  const currentZoomLevel = useRef(10); // Track current zoom for compass updates

  const isDark = isDarkStyle(mapStyle);

  // Get map style value - combined satellite style includes all regional sources
  const mapStyleValue = useMemo(() => {
    return getMapStyle(mapStyle);
  }, [mapStyle]);

  // Dynamic attribution based on visible satellite sources at current location
  const attributionText = useMemo(() => {
    let result: string;
    if (mapStyle === 'satellite' && currentCenter) {
      const satAttribution = getCombinedSatelliteAttribution(
        currentCenter[1],
        currentCenter[0],
        currentZoom
      );
      result = is3DMode ? `${satAttribution} | ${TERRAIN_ATTRIBUTION}` : satAttribution;
    } else {
      const baseAttribution = MAP_ATTRIBUTIONS[mapStyle];
      result = is3DMode ? `${baseAttribution} | ${TERRAIN_ATTRIBUTION}` : baseAttribution;
    }
    return result;
  }, [mapStyle, currentCenter, currentZoom, is3DMode]);

  // Notify parent when attribution changes
  useEffect(() => {
    onAttributionChange?.(attributionText);
  }, [attributionText, onAttributionChange]);

  // Calculate bounds from activities (used for initial camera position)
  // Uses normalizeBounds to auto-detect coordinate format from API
  // Returns bounds AND centers on the most recent activity's location
  const calculateBoundsAndCenter = useCallback((activityList: ActivityBoundsItem[]) => {
    if (activityList.length === 0) return null;

    let minLat = Infinity,
      maxLat = -Infinity;
    let minLng = Infinity,
      maxLng = -Infinity;

    for (const activity of activityList) {
      const normalized = normalizeBounds(activity.bounds);
      minLat = Math.min(minLat, normalized.minLat);
      maxLat = Math.max(maxLat, normalized.maxLat);
      minLng = Math.min(minLng, normalized.minLng);
      maxLng = Math.max(maxLng, normalized.maxLng);
    }

    // Find the most recent activity and center on it
    const sortedByDate = [...activityList].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    const mostRecent = sortedByDate[0];
    const recentBounds = normalizeBounds(mostRecent.bounds);
    const centerLng = (recentBounds.minLng + recentBounds.maxLng) / 2;
    const centerLat = (recentBounds.minLat + recentBounds.maxLat) / 2;

    // Calculate zoom level based on full bounds span
    // Using Mercator projection formula: zoom = log2(360 / lonSpan) or log2(180 / latSpan)
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    // Add padding factor to ensure some margin around activities
    const latZoom = Math.log2(180 / (latSpan || 1)) - 0.5;
    const lngZoom = Math.log2(360 / (lngSpan || 1)) - 0.5;
    // Use the smaller zoom (shows more area) to fit all activities
    const zoomLevel = Math.max(1, Math.min(latZoom, lngZoom));

    return {
      bounds: {
        ne: [maxLng, maxLat] as [number, number],
        sw: [minLng, minLat] as [number, number],
      },
      center: [centerLng, centerLat] as [number, number],
      zoomLevel,
    };
  }, []);

  // Set initial bounds once when we first have activities
  // This prevents the zoom from jumping during background sync
  // But center is always computed fresh to reflect most recent activity
  useEffect(() => {
    if (initialBoundsRef.current === null && activities.length > 0) {
      initialBoundsRef.current = calculateBoundsAndCenter(activities);
    }
  }, [activities, calculateBoundsAndCenter]);

  // Compute center from current activities (always uses most recent activity)
  // But use cached bounds/zoom to prevent jumping during sync
  const currentData = calculateBoundsAndCenter(activities);
  const cachedData = initialBoundsRef.current;
  const mapBounds = cachedData?.bounds ?? currentData?.bounds ?? null;
  const mapCenter = currentData?.center ?? cachedData?.center ?? null;
  const mapZoom = cachedData?.zoomLevel ?? currentData?.zoomLevel ?? 2;

  // Initialize currentCenter from mapCenter for region-aware satellite source detection
  // This effect runs when mapCenter is computed from activities and currentCenter hasn't been set yet
  // Also handles the case when mapCenter changes significantly (e.g., new activities loaded)
  useEffect(() => {
    if (mapCenter !== null) {
      if (currentCenter === null) {
        // First initialization
        setCurrentCenter(mapCenter);
        setCurrentZoom(mapZoom);
      }
    }
  }, [currentCenter, mapCenter, mapZoom]);

  // Extract handlers to separate hook
  const {
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
    userLocationTimeoutRef,
  } = useMapHandlers({
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
  });

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (userLocationTimeoutRef.current) {
        clearTimeout(userLocationTimeoutRef.current);
      }
    };
  }, [userLocationTimeoutRef]);

  // Clear selections when their corresponding group visibility is turned off
  // This is a safety net to ensure selections are always cleared when hiding groups
  useEffect(() => {
    if (!showActivities && selected) {
      setSelected(null);
    }
  }, [showActivities, selected]);

  useEffect(() => {
    if (!showSections && selectedSection) {
      setSelectedSection(null);
    }
  }, [showSections, selectedSection]);

  useEffect(() => {
    if (!showRoutes && selectedRoute) {
      setSelectedRoute(null);
    }
  }, [showRoutes, selectedRoute]);

  // Toggle map style (cycles through light → dark → satellite)
  const toggleStyle = () => {
    setMapStyle((current) => getNextStyle(current));
  };

  // Toggle 3D mode
  const toggle3D = () => {
    setIs3DMode((current) => !current);
  };

  // Filter activities to only those visible in viewport (for performance)
  // Only enable viewport culling for large activity counts to avoid marker flashing
  // With < 500 activities, showing all is fast enough and provides better UX
  const VIEWPORT_CULLING_THRESHOLD = 500;
  const visibleActivities = useMemo(() => {
    // Skip viewport culling for small activity counts - prevents marker flashing during pan
    if (activities.length < VIEWPORT_CULLING_THRESHOLD) {
      return activities;
    }
    if (!visibleActivityIds) {
      // No viewport info yet - show all activities
      return activities;
    }
    // Filter to only visible activities (only for large datasets)
    return activities.filter((a) => visibleActivityIds.has(a.id));
  }, [activities, visibleActivityIds]);

  // ===========================================
  // GPS TRACE RENDERING - Show simplified routes when zoomed in
  // ===========================================
  // Uses route signatures (simplified ~100 point tracks) for performance
  // Only renders when zoom > TRACE_ZOOM_THRESHOLD

  const showTraces = currentZoom >= TRACE_ZOOM_THRESHOLD;

  // ===========================================
  // 120HZ OPTIMIZATION: Stable traces GeoJSON
  // ===========================================
  // Build GeoJSON for GPS traces from route signatures
  // NOTE: Does NOT include isSelected - use MapLibre expressions with selectedActivityId
  // CRITICAL: Always return valid FeatureCollection to avoid iOS MapLibre crash
  // when ShapeSources are conditionally added/removed during React reconciliation
  // Fabric crash fix: Keep feature count STABLE to avoid "Attempt to recycle a mounted view"
  // Always include all traces in the GeoJSON - control visibility via layer opacity instead
  // This prevents Fabric from needing to add/remove views when zoom changes
  // NOTE: Empty FeatureCollection is valid - control visibility via layer opacity
  const tracesGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    // Empty collection when no activities (ShapeSource stays mounted, avoiding Fabric crash)
    const emptyCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };

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
              `[RegionalMapView] INVALID TRACE: activity=${activity.id} originalPoints=${originalCount} validPoints=${coordinates.length}`
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
        `[RegionalMapView] tracesGeoJSON: skipped ${skippedCount} traces with insufficient coordinates`
      );
    }

    // Return minimal geometry only if no features at all
    if (features.length === 0) return emptyCollection;

    return { type: 'FeatureCollection', features };
  }, [visibleActivities, routeSignatures]); // Removed showTraces dependency - always build all traces

  // ===========================================
  // SECTIONS GEOJSON - Frequent road/trail sections
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no data
  const sectionsGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const emptyCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };
    if (sections.length === 0) return emptyCollection;

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
              `[RegionalMapView] INVALID SECTION: id=${section.id} name="${section.name}" originalPoints=${originalCount} validPoints=${validPoints.length} finitePoints=${finitePoints.length}`
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
        `[RegionalMapView] sectionsGeoJSON: skipped ${skippedCount}/${sections.length} sections with invalid polylines`
      );
    }

    return { type: 'FeatureCollection', features };
  }, [sections, t]);

  // ===========================================
  // ROUTES GEOJSON - Polylines for route groups
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no data
  const routesGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const emptyCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };
    if (!showRoutes || routeGroups.length === 0) return emptyCollection;

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
              `[RegionalMapView] INVALID ROUTE: groupId=${group.id} name="${group.name}" originalPoints=${originalCount} validPoints=${coordinates.length}`
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
        `[RegionalMapView] routesGeoJSON: skipped ${skippedCount}/${routeGroups.length} routes with invalid polylines`
      );
    }

    return { type: 'FeatureCollection', features };
  }, [showRoutes, routeGroups, routeSignatures]);

  // ===========================================
  // ROUTE MARKERS GEOJSON - Start points for routes
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no data
  const routeMarkersGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const emptyCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };
    if (!showRoutes || routeGroups.length === 0) return emptyCollection;

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
              `[RegionalMapView] INVALID ROUTE MARKER: groupId=${group.id} startPoint=${JSON.stringify(startPoint)}`
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
        `[RegionalMapView] routeMarkersGeoJSON: skipped ${skippedCount} route markers with invalid start points`
      );
    }

    return { type: 'FeatureCollection', features };
  }, [showRoutes, routeGroups, routeSignatures]);

  // ===========================================
  // SECTION MARKERS - Start points for sections (for MarkerView rendering)
  // ===========================================
  // CRITICAL: Do NOT filter based on showSections - always compute markers
  // to keep MarkerViews stable and avoid iOS crash during reconciliation
  const sectionMarkers = useMemo(() => {
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
          name: section.name,
          coordinate: [startPoint.lng, startPoint.lat] as [number, number],
          sportType: section.sportType,
          visitCount: section.visitCount,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [sections]);

  // ===========================================
  // ROUTE MARKERS - Start points for routes (for MarkerView rendering)
  // ===========================================
  // CRITICAL: Do NOT filter based on showRoutes - always compute markers
  // to keep MarkerViews stable and avoid iOS crash during reconciliation
  const routeMarkers = useMemo(() => {
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
  // USER LOCATION GEOJSON - Rendered as CircleLayer to avoid Fabric crash
  // ===========================================
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no location
  // Using CircleLayer instead of MarkerView prevents Fabric view recycling crash
  const userLocationGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    // Return empty collection when no location - visibility controlled via layer opacity
    if (!userLocation) {
      return { type: 'FeatureCollection', features: [] };
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

  // Handle route press - show route popup
  const handleRoutePress = useCallback(
    (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const feature = event.nativeEvent.features?.[0];
      const routeId = feature?.properties?.id as string | undefined;
      if (routeId) {
        const route = routeGroups.find((g) => g.id === routeId);
        if (route) {
          setSelectedRoute({
            id: route.id,
            name: route.name,
            activityCount: route.activityCount,
            sportType: route.sportType,
            type: route.type,
            bestTime: route.bestTime,
          });
        }
      }
    },
    [routeGroups]
  );

  // ===========================================
  // NATIVE MARKER RENDERING - Uses CircleLayer instead of React components
  // ===========================================
  // This completely avoids touch interception issues with Pressable
  // Markers are rendered as native map features, preserving all gestures

  // ===========================================
  // 120HZ OPTIMIZATION: Stable sort order
  // ===========================================
  // Sort activities so selected is rendered last (on top)
  // Uses selectedActivityId to avoid re-sorting when other selection properties change
  const sortedVisibleActivities = useMemo(() => {
    const selId = selected?.activity.id;
    if (!selId) return visibleActivities; // No selection, no need to sort
    return [...visibleActivities].sort((a, b) => {
      if (selId === a.id) return 1;
      if (selId === b.id) return -1;
      return 0;
    });
  }, [visibleActivities, selected?.activity.id]);

  // ===========================================
  // 120HZ OPTIMIZATION: Stable GeoJSON that doesn't rebuild on selection
  // ===========================================
  // Build GeoJSON feature collection for activity markers (only visible ones)
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
              `[RegionalMapView] INVALID MARKER: activity=${activity.id} center=${JSON.stringify(center)}`
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
        `[RegionalMapView] markersGeoJSON: skipped ${skippedCount}/${visibleActivities.length} activities with invalid centers`
      );
    }

    return {
      type: 'FeatureCollection' as const,
      features: features as GeoJSON.Feature[],
    };
  }, [visibleActivities, activityCenters]);

  // Selected activity ID for MapLibre expressions (cheap to pass, doesn't trigger GeoJSON rebuild)
  const selectedActivityId = selected?.activity.id ?? null;

  // Build route GeoJSON for selected activity
  // Uses the same coordinate conversion as ActivityMapView for consistency
  // CRITICAL: Always render ShapeSource to avoid Fabric crash - use empty FeatureCollection when no data
  const routeGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    const emptyCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };
    if (!selected?.mapData?.latlngs) return emptyCollection;

    // Filter out null values first
    const nonNullCoords = selected.mapData.latlngs.filter((c): c is [number, number] => c !== null);

    if (nonNullCoords.length === 0) {
      if (__DEV__) {
        console.warn(
          `[RegionalMapView] routeGeoJSON: no non-null coords for activity=${selected.activity.id}`
        );
      }
      return emptyCollection;
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
          `[RegionalMapView] routeGeoJSON: insufficient valid coords for activity=${selected.activity.id} original=${nonNullCoords.length} valid=${validCoords.length}`
        );
      }
      return emptyCollection;
    }

    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords,
      },
    };
  }, [selected?.mapData, selected?.activity.id]);

  // Helper to check if routeGeoJSON has data
  const routeHasData =
    routeGeoJSON.type === 'Feature' ||
    (routeGeoJSON.type === 'FeatureCollection' && routeGeoJSON.features.length > 0);

  // Get 3D route coordinates from selected activity (if any)
  // Filter NaN/Infinity to prevent invalid GeoJSON in Map3DWebView
  const route3DCoords = useMemo(() => {
    if (!selected?.mapData?.latlngs) return [];

    return selected.mapData.latlngs
      .filter((c): c is [number, number] => c !== null)
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
      .map(([lat, lng]) => [lng, lat] as [number, number]); // Convert to [lng, lat]
  }, [selected?.mapData]);

  // 3D is available when we have any activities (terrain can be shown without a specific route)
  const can3D = activities.length > 0;
  // Show 3D view when enabled
  const show3D = is3DMode && can3D;

  // iOS tap handler - uses screen coordinates directly since MapView.onPress doesn't work with Fabric
  const handleiOSTap = useCallback(
    async (screenX: number, screenY: number) => {
      if (!showActivities || isHeatmapMode) {
        if (selected) setSelected(null);
        return;
      }

      // Find nearest marker by screen distance
      let nearestActivity: (typeof activities)[0] | null = null;
      let nearestDistance = Infinity;

      for (const activity of activities) {
        const center = activityCenters[activity.id];
        if (!center) continue;

        const markerScreenPos = await mapRef.current?.project(center);
        if (!markerScreenPos) continue;

        const dx = screenX - markerScreenPos[0];
        const dy = screenY - markerScreenPos[1];
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestActivity = activity;
        }
      }

      // Zoom-dependent threshold: larger at world zoom (markers clustered), smaller at city zoom
      // currentZoomLevel is tracked via handleRegionDidChange
      const zoom = currentZoomLevel.current;
      const PIXEL_THRESHOLD = zoom < 4 ? 80 : zoom < 8 ? 60 : zoom < 12 ? 44 : 30;

      console.log(
        '[iOS tap] nearest:',
        nearestActivity?.id,
        'dist:',
        nearestDistance.toFixed(0),
        'threshold:',
        PIXEL_THRESHOLD,
        'selected:',
        selected?.activity?.id
      );

      if (nearestActivity && nearestDistance < PIXEL_THRESHOLD) {
        console.log('[iOS tap] HIT - selecting:', nearestActivity.id);
        handleMarkerTap(nearestActivity);
      } else if (selected) {
        console.log('[iOS tap] MISS - clearing selection');
        setSelected(null);
      } else {
        console.log('[iOS tap] MISS - nothing selected');
      }
    },
    [
      activities,
      activityCenters,
      handleMarkerTap,
      selected,
      setSelected,
      showActivities,
      isHeatmapMode,
      currentZoomLevel,
    ]
  );

  // Track touch start for iOS tap detection (to distinguish taps from gestures)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  return (
    <View
      style={styles.container}
      onTouchStart={
        Platform.OS === 'ios'
          ? (e) => {
              touchStartRef.current = {
                x: e.nativeEvent.locationX,
                y: e.nativeEvent.locationY,
                time: Date.now(),
              };
            }
          : undefined
      }
      onTouchEnd={
        Platform.OS === 'ios'
          ? (e) => {
              const start = touchStartRef.current;
              console.log('[iOS touchEnd] start:', !!start);
              if (!start) return;

              const dx = Math.abs(e.nativeEvent.locationX - start.x);
              const dy = Math.abs(e.nativeEvent.locationY - start.y);
              const duration = Date.now() - start.time;

              // Only treat as tap if: short duration, minimal movement, not in button area
              const isTap = duration < 300 && dx < 10 && dy < 10;
              const isInMapArea = e.nativeEvent.locationY > insets.top + 60; // Below buttons

              console.log(
                '[iOS touchEnd] isTap:',
                isTap,
                'isInMapArea:',
                isInMapArea,
                'show3D:',
                show3D
              );

              if (isTap && isInMapArea && !show3D) {
                handleiOSTap(e.nativeEvent.locationX, e.nativeEvent.locationY);
              }
              touchStartRef.current = null;
            }
          : undefined
      }
    >
      {show3D ? (
        <Map3DWebView
          ref={map3DRef}
          coordinates={route3DCoords.length > 0 ? route3DCoords : undefined}
          mapStyle={mapStyle}
          routeColor={selected ? getActivityTypeConfig(selected.activity.type).color : undefined}
          initialCenter={currentCenter ?? mapCenter ?? undefined}
          initialZoom={currentZoom}
          routesGeoJSON={showRoutes ? (routesGeoJSON ?? undefined) : undefined}
          sectionsGeoJSON={showSections ? (sectionsGeoJSON ?? undefined) : undefined}
          tracesGeoJSON={showTraces ? (tracesGeoJSON ?? undefined) : undefined}
        />
      ) : (
        <MapView
          key={`regional-map-${mapKey}`}
          ref={mapRef}
          style={styles.map}
          mapStyle={mapStyleValue}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          onPress={Platform.OS === 'android' ? handleMapPress : undefined}
          onRegionIsChanging={handleRegionIsChanging}
          onRegionDidChange={handleRegionDidChange}
          onDidFailLoadingMap={handleMapLoadError}
          onDidFinishRenderingMapFully={() => {
            // Delay MarkerView rendering to work around race conditions
            setTimeout(() => setMapFullyRendered(true), 100);
          }}
        >
          {/* Camera with ref for programmatic control */}
          {/* Uses center biased toward recent activities (longitude from recent, latitude from all) */}
          <Camera
            ref={cameraRef as React.RefObject<CameraRef>}
            centerCoordinate={mapCenter ?? undefined}
            zoomLevel={mapZoom}
          />

          {/* Activity markers - visual only, taps handled by ShapeSource rendered later */}
          {/* CRITICAL: Always render ALL MarkerViews to avoid iOS Fabric crash during reconciliation */}
          {/* iOS crash: -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207) */}
          {/* Never return null - use opacity:0 and fallback coordinate for invalid centers */}
          {/* pointerEvents="none" ensures these don't intercept touches (fixes Android rendering) */}
          {/* Sorted to render selected activity last (on top) */}
          {sortedVisibleActivities.map((activity) => {
            const config = getActivityTypeConfig(activity.type);
            // Use pre-computed center (no format detection during render!)
            const center = activityCenters[activity.id];
            // Validate center has valid finite coordinates
            const hasValidCenter =
              center &&
              Array.isArray(center) &&
              center.length >= 2 &&
              Number.isFinite(center[0]) &&
              Number.isFinite(center[1]);
            // Use fallback coordinate [-180, -90] for invalid centers (will be hidden via opacity)
            const safeCenter: [number, number] = hasValidCenter ? center : [-180, -90];
            const size = getMarkerSize(activity.distance);
            const isSelected = selectedActivityId === activity.id;
            const markerSize = isSelected ? size + 8 : size;
            // Larger icon ratio to fill more of the marker
            const iconSize = isSelected ? size * 0.75 : size * 0.7;
            // Hide markers when: no valid center, activities toggle is off, in heatmap mode,
            // or on Android before map is fully rendered (v11 has race condition with coordinates)
            const isVisible =
              hasValidCenter &&
              showActivities &&
              !isHeatmapMode &&
              (Platform.OS === 'ios' || mapFullyRendered);

            // Visual marker content
            const markerVisual = (
              <View
                testID={`map-activity-marker-${activity.id}`}
                style={{
                  width: markerSize,
                  height: markerSize,
                  borderRadius: markerSize / 2,
                  backgroundColor: config.color,
                  borderWidth: isSelected ? 2 : 1.5,
                  borderColor: isSelected ? colors.primary : colors.textOnDark,
                  justifyContent: 'center',
                  alignItems: 'center',
                  opacity: isVisible ? 1 : 0,
                  ...shadows.elevated,
                }}
              >
                <Ionicons name={config.icon} size={iconSize} color={colors.textOnDark} />
              </View>
            );

            // Tap handling:
            // - iOS: MapView.onPress with pixel-based detection (ShapeSource.onPress broken with Fabric)
            // - Android: ShapeSource + CircleLayer native tap detection
            // Both platforms use pointerEvents="none" - no touch interception from markers
            return (
              <MarkerView
                key={`marker-${activity.id}`}
                coordinate={safeCenter}
                anchor={{ x: 0.5, y: 0.5 }}
                allowOverlap={true}
              >
                <View pointerEvents="none">{markerVisual}</View>
              </MarkerView>
            );
          })}

          {/* Activity markers - CircleLayer for Android (MarkerView broken in v11), tap areas for both */}
          {/* Android: CircleLayer shows colored circles since v11 MarkerView positioning is broken */}
          {/* iOS: CircleLayer provides hit detection; MarkerViews above show icons */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS crash during view reconciliation */}
          <ShapeSource
            id="activity-markers-hitarea"
            shape={markersGeoJSON}
            onPress={!isHeatmapMode && showActivities ? handleMarkerPress : undefined}
            hitbox={{ width: 44, height: 44 }}
          >
            <CircleLayer
              id="marker-hitarea"
              style={{
                // On Android: Show colored circles as fallback until MarkerViews render correctly
                // On iOS: Invisible hit detection only (MarkerViews handle visuals)
                circleRadius:
                  !isHeatmapMode && showActivities
                    ? [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        1,
                        8, // World view
                        6,
                        10, // Continental
                        10,
                        12, // Regional
                        14,
                        14, // City level
                      ]
                    : 0,
                // Android fallback: colored circles; iOS: invisible (MarkerViews show icons)
                circleColor: Platform.OS === 'android' ? ['get', 'color'] : 'transparent',
                circleOpacity:
                  !isHeatmapMode && showActivities && Platform.OS === 'android' ? 1 : 0,
                circleStrokeWidth: Platform.OS === 'android' ? 2 : 0,
                circleStrokeColor: '#FFFFFF',
              }}
            />
          </ShapeSource>

          {/* Routes layer - dashed polylines for route groups */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash during reconciliation */}
          <ShapeSource
            id="routes"
            shape={routesGeoJSON}
            onPress={handleRoutePress}
            hitbox={{ width: 44, height: 44 }}
          >
            <LineLayer
              id="routesLine"
              style={{
                visibility: showRoutes && !isHeatmapMode ? 'visible' : 'none',
                lineColor: '#9C27B0',
                lineWidth: [
                  'case',
                  ['==', ['get', 'id'], selectedRoute?.id ?? ''],
                  6, // Bold when selected
                  3,
                ],
                lineOpacity: [
                  'case',
                  ['==', ['get', 'id'], selectedRoute?.id ?? ''],
                  1, // Full opacity when selected
                  0.7,
                ],
                lineDasharray: [3, 2],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>

          {/* Route markers - start points for routes */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash */}
          {/* Visual markers rendered as MarkerViews below for icon support */}
          <ShapeSource id="route-markers" shape={routeMarkersGeoJSON}>
            <CircleLayer
              id="routeMarkerCircle"
              style={{
                circleRadius: 0, // Hidden - using MarkerViews instead
                circleOpacity: 0,
              }}
            />
          </ShapeSource>

          {/* Sections layer - frequent road/trail sections */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash */}
          <ShapeSource
            id="sections"
            shape={sectionsGeoJSON}
            onPress={handleSectionPress}
            hitbox={{ width: 44, height: 44 }}
          >
            {/* Section lines - thicker and more prominent than traces */}
            {/* Note: MapLibre doesn't allow nested zoom-based interpolations in case expressions */}
            <LineLayer
              id="sectionsLine"
              style={{
                lineColor: ['get', 'color'],
                // Note: zoom expressions cannot be nested inside case expressions
                // Use fixed widths when selection is active to avoid MapLibre crash
                lineWidth: selectedSection
                  ? [
                      'case',
                      ['==', ['get', 'id'], selectedSection.id],
                      8, // Bold when selected
                      4, // Fixed width for unselected (can't use zoom interpolate here)
                    ]
                  : ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 18, 7],
                lineOpacity:
                  showSections && !isHeatmapMode
                    ? selectedSection
                      ? [
                          'case',
                          ['==', ['get', 'id'], selectedSection.id],
                          1, // Full opacity when selected
                          0.85,
                        ]
                      : 0.85
                    : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            {/* Section outline for better visibility */}
            <LineLayer
              id="sectionsOutline"
              style={{
                lineColor: colors.textOnDark,
                // Note: zoom expressions cannot be nested inside case expressions
                // Use fixed widths when selection is active to avoid MapLibre crash
                lineWidth: selectedSection
                  ? [
                      'case',
                      ['==', ['get', 'id'], selectedSection.id],
                      10, // Bold when selected
                      6, // Fixed width for unselected (can't use zoom interpolate here)
                    ]
                  : ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7, 18, 9],
                lineOpacity:
                  showSections && !isHeatmapMode
                    ? selectedSection
                      ? [
                          'case',
                          ['==', ['get', 'id'], selectedSection.id],
                          0.6, // More visible when selected
                          0.4,
                        ]
                      : 0.4
                    : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              belowLayerID="sectionsLine"
            />
          </ShapeSource>

          {/* Heatmap layer - iOS crash fix: always render, control via visible prop */}
          <HeatmapLayer
            heatmap={heatmap}
            onCellPress={handleHeatmapCellPress}
            opacity={0.7}
            highlightCommonPaths={true}
            visible={isHeatmapMode && !!heatmap}
          />

          {/* GPS traces - simplified routes shown when zoomed in (hidden in heatmap mode) */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash */}
          <ShapeSource id="activity-traces" shape={tracesGeoJSON}>
            <LineLayer
              id="tracesLine"
              style={{
                lineColor: ['get', 'color'],
                lineWidth: [
                  'case',
                  // Hide selected trace (full route shown instead)
                  // Uses selectedActivityId variable instead of isSelected property for 120Hz
                  ['==', ['get', 'id'], selectedActivityId ?? ''],
                  0,
                  2,
                ],
                // Fabric crash fix: Control visibility via opacity, not feature count
                lineOpacity: showTraces && !isHeatmapMode ? 0.4 : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>

          {/* Selected activity route */}
          {/* CRITICAL: Always render with fixed ID to avoid iOS MapLibre crash */}
          <ShapeSource id="selected-route" shape={routeGeoJSON}>
            {/* Outline layer for better visibility */}
            <LineLayer
              id="selected-routeOutline"
              style={{
                lineColor: colors.textOnDark,
                lineWidth: 8,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: routeHasData ? 0.5 : 0,
              }}
            />
            <LineLayer
              id="selected-routeLine"
              style={{
                lineColor: selected ? getActivityTypeConfig(selected.activity.type).color : '#000',
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: routeHasData ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* Section markers - start points with road icon */}
          {/* CRITICAL: Always render to avoid iOS crash - use opacity to hide */}
          {/* pointerEvents="none" is CRITICAL for Android - Pressable breaks marker positioning */}
          {/* Tap the section polyline to select (handled by ShapeSource onPress) */}
          {sectionMarkers.map((marker) => {
            const isVisible = showSections && !isHeatmapMode;
            const isSelected = selectedSection?.id === marker.id;

            return (
              <MarkerView
                key={`section-marker-${marker.id}`}
                coordinate={marker.coordinate}
                anchor={{ x: 0.5, y: 0.5 }}
                allowOverlap={true}
              >
                <View
                  testID={`map-section-marker-${marker.id}`}
                  pointerEvents="none"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: isSelected ? colors.primary : '#4CAF50',
                    borderWidth: 2,
                    borderColor: colors.textOnDark,
                    justifyContent: 'center',
                    alignItems: 'center',
                    opacity: isVisible ? 1 : 0,
                    ...shadows.elevated,
                  }}
                >
                  <MaterialCommunityIcons name="road-variant" size={18} color={colors.textOnDark} />
                </View>
              </MarkerView>
            );
          })}

          {/* Route markers - start points with path icon */}
          {/* CRITICAL: Always render to avoid iOS crash - use opacity to hide */}
          {/* pointerEvents="none" is CRITICAL for Android - Pressable breaks marker positioning */}
          {/* Tap the route polyline to select (handled by ShapeSource onPress) */}
          {routeMarkers.map((marker) => {
            const isVisible = showRoutes && !isHeatmapMode;
            const isSelected = selectedRoute?.id === marker.id;

            return (
              <MarkerView
                key={`route-marker-${marker.id}`}
                coordinate={marker.coordinate}
                anchor={{ x: 0.5, y: 0.5 }}
                allowOverlap={true}
              >
                <View
                  testID={`map-route-marker-${marker.id}`}
                  pointerEvents="none"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: isSelected ? colors.primary : '#9C27B0',
                    borderWidth: 2,
                    borderColor: colors.textOnDark,
                    justifyContent: 'center',
                    alignItems: 'center',
                    opacity: isVisible ? 1 : 0,
                    ...shadows.elevated,
                  }}
                >
                  <MaterialCommunityIcons
                    name="map-marker-path"
                    size={18}
                    color={colors.textOnDark}
                  />
                </View>
              </MarkerView>
            );
          })}

          {/* User location marker - using ShapeSource + CircleLayer to avoid Fabric crash */}
          {/* CRITICAL: Always render to prevent add/remove cycles that crash iOS */}
          <ShapeSource id="user-location" shape={userLocationGeoJSON}>
            <CircleLayer
              id="user-location-outer"
              style={{
                circleRadius: 12,
                circleColor: colors.primary,
                circleOpacity: userLocation ? 0.3 : 0,
                circleStrokeWidth: 0,
              }}
            />
            <CircleLayer
              id="user-location-inner"
              style={{
                circleRadius: 6,
                circleColor: colors.primary,
                circleOpacity: userLocation ? 1 : 0,
                circleStrokeWidth: 2,
                circleStrokeColor: colors.textOnDark,
              }}
            />
          </ShapeSource>
        </MapView>
      )}

      {/* Close button */}
      <TouchableOpacity
        style={[
          styles.button,
          styles.closeButton,
          { top: insets.top + 12 },
          isDark && styles.buttonDark,
        ]}
        onPress={onClose}
        activeOpacity={0.8}
        accessibilityLabel={t('maps.closeMap')}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons
          name="close"
          size={24}
          color={isDark ? colors.textOnDark : colors.textSecondary}
        />
      </TouchableOpacity>
      {/* Style toggle */}
      <TouchableOpacity
        style={[
          styles.button,
          styles.styleButton,
          { top: insets.top + 12 },
          isDark && styles.buttonDark,
        ]}
        onPress={toggleStyle}
        activeOpacity={0.8}
        accessibilityLabel={t('maps.toggleStyle')}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons
          name={getStyleIcon(mapStyle)}
          size={24}
          color={isDark ? colors.textOnDark : colors.textSecondary}
        />
      </TouchableOpacity>
      {/* Control button stack - positioned in middle of right side */}
      <MapControlStack
        top={insets.top + 64}
        isDark={isDark}
        is3DMode={is3DMode}
        can3D={can3D}
        isHeatmapMode={isHeatmapMode}
        showActivities={showActivities}
        showSections={showSections}
        showRoutes={showRoutes}
        userLocationActive={!!userLocation}
        heatmap={heatmap}
        sections={sections}
        routeCount={routeGroups.length}
        activityCount={activities.length}
        bearingAnim={bearingAnim}
        onToggle3D={toggle3D}
        onResetOrientation={resetOrientation}
        onGetLocation={handleGetLocation}
        onToggleHeatmap={toggleHeatmap}
        onToggleActivities={toggleActivities}
        onToggleSections={toggleSections}
        onToggleRoutes={toggleRoutes}
        onFitAll={handleFitAll}
      />
      {/* Attribution */}
      {showAttribution && (
        <View style={[styles.attribution, { bottom: insets.bottom + attributionBottomOffset }]}>
          <Text style={styles.attributionText}>{attributionText}</Text>
        </View>
      )}
      {/* Selected activity popup - positioned above the timeline slider */}
      {selected && (
        <ActivityPopup
          selected={selected}
          bottom={insets.bottom + 200}
          onZoom={handleZoomToActivity}
          onClose={handleClosePopup}
          onViewDetails={handleViewDetails}
        />
      )}
      {/* Heatmap cell popup - shows when a heatmap cell is selected */}
      {isHeatmapMode && selectedCell && (
        <HeatmapCellInfo
          cell={selectedCell}
          bottom={insets.bottom + 200}
          onClose={() => setSelectedCell(null)}
        />
      )}
      {/* Section popup - shows when a section is tapped */}
      {selectedSection && (
        <SectionPopup
          section={selectedSection}
          bottom={insets.bottom + 200}
          onClose={() => setSelectedSection(null)}
          onViewDetails={() => {
            setSelectedSection(null);
            router.push(`/section/${selectedSection.id}`);
          }}
        />
      )}
      {/* Route popup - shows when a route is tapped */}
      {selectedRoute && (
        <RoutePopup
          route={selectedRoute}
          bottom={insets.bottom + 200}
          onClose={() => setSelectedRoute(null)}
          onViewDetails={() => {
            setSelectedRoute(null);
            router.push(`/route/${selectedRoute.id}`);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.background,
  },
  map: {
    flex: 1,
  },
  button: {
    position: 'absolute',
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.mapOverlay,
  },
  buttonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  closeButton: {
    left: spacing.md,
  },
  styleButton: {
    right: spacing.md,
  },
  userLocationMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(66, 165, 245, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userLocationDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.chartBlue,
    borderWidth: 2,
    borderColor: colors.textOnDark,
  },
  markerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: colors.textOnDark,
    ...shadows.elevated,
  },
  markerSelected: {
    borderWidth: 3,
    borderColor: colors.primary,
  },
  attribution: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderTopLeftRadius: spacing.sm,
    zIndex: 5,
  },
  attributionText: {
    fontSize: 9,
    color: colors.textSecondary,
  },
});
