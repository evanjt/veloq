import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/hooks';
import {
  MapView,
  Camera,
  MarkerView,
  ShapeSource,
  LineLayer,
  CircleLayer,
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
} from './mapStyles';
import type { ActivityBoundsItem } from '@/types';
import { HeatmapLayer } from './HeatmapLayer';
import { useHeatmap, type CellQueryResult } from '@/hooks/useHeatmap';
import { useFrequentSections, useRouteSignatures, useRouteGroups } from '@/hooks/routes';
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
}

export function RegionalMapView({ activities, onClose }: RegionalMapViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isDark: systemIsDark } = useTheme();
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = systemIsDark ? 'dark' : 'light';
  const [mapStyle, setMapStyle] = useState<MapStyleType>(systemStyle);
  const [selected, setSelected] = useState<SelectedActivity | null>(null);
  const [is3DMode, setIs3DMode] = useState(false);
  const [isHeatmapMode, setIsHeatmapMode] = useState(false);
  const [showSections, setShowSections] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [visibleActivityIds, setVisibleActivityIds] = useState<Set<string> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(10);
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

  // Reset retry count when style changes
  useEffect(() => {
    retryCountRef.current = 0;
  }, [mapStyle]);

  // Get route signatures from Rust engine for trace rendering
  const routeSignatures = useRouteSignatures();

  // Heatmap data from route matching cache
  const { heatmap, queryCell } = useHeatmap();

  // Frequent sections from route matching
  const { sections } = useFrequentSections({ minVisits: 2 });

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
    for (const activity of activities) {
      // Try to use pre-computed center from RouteSignature (computed in Rust)
      const signature = routeSignatures[activity.id];
      if (signature?.center) {
        centers[activity.id] = [signature.center.lng, signature.center.lat];
      } else {
        // Fallback: compute from bounds (only for activities without signatures)
        centers[activity.id] = getBoundsCenter(activity.bounds);
      }
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
  const mapStyleValue = getMapStyle(mapStyle);
  const attributionText = is3DMode
    ? `${MAP_ATTRIBUTIONS[mapStyle]} | ${TERRAIN_ATTRIBUTION}`
    : MAP_ATTRIBUTIONS[mapStyle];

  // Calculate bounds from activities (used for initial camera position)
  // Uses normalizeBounds to auto-detect coordinate format from API
  // Returns bounds AND a center biased toward recent activities
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

    // Calculate center longitude biased toward recent activities
    // Sort by date descending and take most recent activities for center calculation
    const recentCount = Math.min(20, activityList.length);
    const sortedByDate = [...activityList].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    const recentActivities = sortedByDate.slice(0, recentCount);

    // Calculate average longitude from recent activities
    let recentLngSum = 0;
    for (const activity of recentActivities) {
      const normalized = normalizeBounds(activity.bounds);
      recentLngSum += (normalized.minLng + normalized.maxLng) / 2;
    }
    const recentCenterLng = recentLngSum / recentActivities.length;

    // Latitude center uses full bounds (so we see activities at all latitudes)
    const centerLat = (minLat + maxLat) / 2;

    // Calculate zoom level based on bounds span
    // Using Mercator projection formula: zoom = log2(360 / lonSpan) or log2(180 / latSpan)
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    // Add padding factor (0.8) to ensure some margin around activities
    const latZoom = Math.log2(180 / (latSpan || 1)) - 0.5;
    const lngZoom = Math.log2(360 / (lngSpan || 1)) - 0.5;
    // Use the smaller zoom (shows more area) to fit all activities
    const zoomLevel = Math.max(1, Math.min(latZoom, lngZoom));

    return {
      bounds: {
        ne: [maxLng, maxLat] as [number, number],
        sw: [minLng, minLat] as [number, number],
      },
      center: [recentCenterLng, centerLat] as [number, number],
      zoomLevel,
    };
  }, []);

  // Set initial bounds only once when we first have activities
  // This prevents the map from jumping around during background sync
  useEffect(() => {
    if (initialBoundsRef.current === null && activities.length > 0) {
      initialBoundsRef.current = calculateBoundsAndCenter(activities);
    }
  }, [activities, calculateBoundsAndCenter]);

  // Use the stored initial bounds and center for the camera default
  const mapData = initialBoundsRef.current || calculateBoundsAndCenter(activities);
  const mapBounds = mapData?.bounds ?? null;
  const mapCenter = mapData?.center ?? null;
  const mapZoom = mapData?.zoomLevel ?? 2;

  // Extract handlers to separate hook
  const {
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
    toggleSections,
    resetOrientation,
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
    setShowSections,
    setUserLocation,
    setVisibleActivityIds,
    setCurrentZoom,
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
  const tracesGeoJSON = useMemo(() => {
    if (!showTraces) return null;

    const features = visibleActivities
      .filter((activity) => routeSignatures[activity.id]) // Only activities with signatures
      .map((activity) => {
        const signature = routeSignatures[activity.id];
        const config = getActivityTypeConfig(activity.type);

        // Convert signature points to GeoJSON coordinates [lng, lat]
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

  // ===========================================
  // SECTIONS GEOJSON - Frequent road/trail sections
  // ===========================================
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
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [sections, t]);

  // ===========================================
  // ROUTES GEOJSON - Polylines for route groups
  // ===========================================
  const routesGeoJSON = useMemo(() => {
    if (!showRoutes || routeGroups.length === 0) return null;

    const features = routeGroups
      .filter((group) => routeSignatures[group.representativeId])
      .map((group) => {
        const signature = routeSignatures[group.representativeId];
        const coordinates = signature.points.map((pt) => [pt.lng, pt.lat]);

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
      });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [showRoutes, routeGroups, routeSignatures]);

  // ===========================================
  // ROUTE MARKERS GEOJSON - Start points for routes
  // ===========================================
  const routeMarkersGeoJSON = useMemo(() => {
    if (!showRoutes || routeGroups.length === 0) return null;

    const features = routeGroups
      .filter((group) => routeSignatures[group.representativeId])
      .map((group) => {
        const signature = routeSignatures[group.representativeId];
        const startPoint = signature.points[0];

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
      });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [showRoutes, routeGroups, routeSignatures]);

  // Handle route press - show route popup
  const handleRoutePress = useCallback(
    (event: { features?: Array<{ properties?: Record<string, unknown> | null }> }) => {
      const feature = event.features?.[0];
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
  const markersGeoJSON = useMemo(() => {
    const features = visibleActivities.map((activity) => {
      // Use pre-computed center (no format detection during render!)
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

  // Selected activity ID for MapLibre expressions (cheap to pass, doesn't trigger GeoJSON rebuild)
  const selectedActivityId = selected?.activity.id ?? null;

  // Build route GeoJSON for selected activity
  // Uses the same coordinate conversion as ActivityMapView for consistency
  const routeGeoJSON = useMemo(() => {
    if (!selected?.mapData?.latlngs) return null;

    // Filter out null values first
    const nonNullCoords = selected.mapData.latlngs.filter((c): c is [number, number] => c !== null);

    if (nonNullCoords.length === 0) return null;

    // Convert to LatLng objects using the same function as ActivityMapView
    const latLngCoords = convertLatLngTuples(nonNullCoords);

    // Filter valid coordinates and convert to GeoJSON format [lng, lat]
    const validCoords = latLngCoords
      .filter((c) => !isNaN(c.latitude) && !isNaN(c.longitude))
      .map((c) => [c.longitude, c.latitude]);

    if (validCoords.length === 0) return null;

    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords,
      },
    };
  }, [selected?.mapData]);

  // Get 3D route coordinates from selected activity
  const route3DCoords = useMemo(() => {
    if (!selected?.mapData?.latlngs) return [];

    return selected.mapData.latlngs
      .filter((c): c is [number, number] => c !== null)
      .map(([lat, lng]) => [lng, lat] as [number, number]); // Convert to [lng, lat]
  }, [selected?.mapData]);

  // 3D is available when we have route data to display
  const can3D = !!selected && route3DCoords.length > 0;
  // Show 3D view when enabled and we have route data
  const show3D = is3DMode && can3D;

  return (
    <View style={styles.container}>
      {show3D ? (
        <Map3DWebView
          ref={map3DRef}
          coordinates={route3DCoords}
          mapStyle={mapStyle}
          routeColor={getActivityTypeConfig(selected.activity.type).color}
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
          onPress={handleMapPress}
          onRegionIsChanging={handleRegionIsChanging}
          onRegionDidChange={handleRegionDidChange}
          onDidFailLoadingMap={handleMapLoadError}
        >
          {/* Camera with ref for programmatic control */}
          {/* Uses center biased toward recent activities (longitude from recent, latitude from all) */}
          <Camera
            ref={cameraRef}
            defaultSettings={
              mapCenter
                ? {
                    centerCoordinate: mapCenter,
                    zoomLevel: mapZoom,
                  }
                : undefined
            }
            animationDuration={0}
          />

          {/* Invisible ShapeSource for tap detection only - no visual rendering */}
          {/* This handles taps without intercepting gestures */}
          {/* Hidden in heatmap mode */}
          {!isHeatmapMode && (
            <ShapeSource
              id="activity-markers"
              shape={markersGeoJSON}
              onPress={handleMarkerPress}
              hitbox={{ width: 44, height: 44 }}
            >
              {/* Invisible circles just for hit detection */}
              <CircleLayer
                id="marker-hitarea"
                style={{
                  circleRadius: ['/', ['get', 'size'], 2],
                  circleColor: 'transparent',
                  circleStrokeWidth: 0,
                }}
              />
            </ShapeSource>
          )}

          {/* Activity markers - visual only, rendered as MarkerView for correct z-ordering */}
          {/* pointerEvents="none" ensures these don't intercept any touches */}
          {/* Sorted to render selected activity last (on top) */}
          {/* Only renders visible activities for performance (viewport culling) */}
          {/* Hidden in heatmap mode */}
          {/* filter(Boolean) prevents null children crash on iOS MapLibre */}
          {!isHeatmapMode &&
            sortedVisibleActivities
              .map((activity) => {
                const config = getActivityTypeConfig(activity.type);
                // Use pre-computed center (no format detection during render!)
                const center = activityCenters[activity.id];
                // Skip if center not computed yet (prevents iOS crash with undefined coordinate)
                if (!center) return null;
                const size = getMarkerSize(activity.distance);
                const isSelected = selectedActivityId === activity.id;
                const markerSize = isSelected ? size + 8 : size;
                // Larger icon ratio to fill more of the marker
                const iconSize = isSelected ? size * 0.75 : size * 0.7;

                return (
                  <MarkerView
                    key={`marker-${activity.id}`}
                    coordinate={center}
                    anchor={{ x: 0.5, y: 0.5 }}
                    allowOverlap={true}
                  >
                    {/* Single view with fixed dimensions - no flex/dynamic sizing */}
                    <View
                      pointerEvents="none"
                      style={{
                        width: markerSize,
                        height: markerSize,
                        borderRadius: markerSize / 2,
                        backgroundColor: config.color,
                        // Thinner border to give more space for the icon
                        borderWidth: isSelected ? 2 : 1.5,
                        borderColor: isSelected ? colors.primary : colors.textOnDark,
                        justifyContent: 'center',
                        alignItems: 'center',
                        ...shadows.elevated,
                      }}
                    >
                      <Ionicons name={config.icon} size={iconSize} color={colors.textOnDark} />
                    </View>
                  </MarkerView>
                );
              })
              .filter(Boolean)}

          {/* Routes layer - dashed polylines for route groups */}
          {showRoutes && !isHeatmapMode && routesGeoJSON && routesGeoJSON.features.length > 0 && (
            <ShapeSource
              id="routes"
              shape={routesGeoJSON}
              onPress={handleRoutePress}
              hitbox={{ width: 20, height: 20 }}
            >
              <LineLayer
                id="routesLine"
                style={{
                  lineColor: '#9C27B0',
                  lineWidth: 3,
                  lineOpacity: 0.7,
                  lineDasharray: [3, 2],
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </ShapeSource>
          )}

          {/* Route markers - start points for routes */}
          {showRoutes &&
            !isHeatmapMode &&
            routeMarkersGeoJSON &&
            routeMarkersGeoJSON.features.length > 0 && (
              <ShapeSource id="route-markers" shape={routeMarkersGeoJSON}>
                <CircleLayer
                  id="routeMarkerCircle"
                  style={{
                    circleRadius: 10,
                    circleColor: '#9C27B0',
                    circleStrokeWidth: 2,
                    circleStrokeColor: '#FFFFFF',
                  }}
                />
              </ShapeSource>
            )}

          {/* Sections layer - frequent road/trail sections */}
          {showSections &&
            !isHeatmapMode &&
            sectionsGeoJSON &&
            sectionsGeoJSON.features.length > 0 && (
              <ShapeSource
                id="sections"
                shape={sectionsGeoJSON}
                onPress={handleSectionPress}
                hitbox={{ width: 20, height: 20 }}
              >
                {/* Section lines - thicker and more prominent than traces */}
                <LineLayer
                  id="sectionsLine"
                  style={{
                    lineColor: ['get', 'color'],
                    lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 18, 7],
                    lineOpacity: 0.85,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
                {/* Section outline for better visibility */}
                <LineLayer
                  id="sectionsOutline"
                  style={{
                    lineColor: colors.textOnDark,
                    lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7, 18, 9],
                    lineOpacity: 0.4,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                  belowLayerID="sectionsLine"
                />
              </ShapeSource>
            )}

          {/* Heatmap layer - shown when heatmap mode is active */}
          {isHeatmapMode && heatmap && (
            <HeatmapLayer
              heatmap={heatmap}
              onCellPress={handleHeatmapCellPress}
              opacity={0.7}
              highlightCommonPaths={true}
            />
          )}

          {/* GPS traces - simplified routes shown when zoomed in (hidden in heatmap mode) */}
          {/* Rendered with low opacity, below the selected activity route */}
          {!isHeatmapMode && tracesGeoJSON && tracesGeoJSON.features.length > 0 && (
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
                  lineOpacity: 0.4,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </ShapeSource>
          )}

          {/* Selected activity route */}
          {/* Key forces re-render when activity changes to ensure proper positioning */}
          {routeGeoJSON && selected && (
            <ShapeSource
              key={`route-${selected.activity.id}`}
              id={`route-${selected.activity.id}`}
              shape={routeGeoJSON}
            >
              <LineLayer
                id={`routeLine-${selected.activity.id}`}
                style={{
                  lineColor: getActivityTypeConfig(selected.activity.type).color,
                  lineWidth: 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </ShapeSource>
          )}

          {/* User location marker */}
          {userLocation && (
            <MarkerView coordinate={userLocation} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.userLocationMarker}>
                <View style={styles.userLocationDot} />
              </View>
            </MarkerView>
          )}
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
        showSections={showSections}
        showRoutes={showRoutes}
        userLocationActive={!!userLocation}
        heatmap={heatmap}
        sections={sections}
        routeCount={routeGroups.length}
        bearingAnim={bearingAnim}
        onToggle3D={toggle3D}
        onResetOrientation={resetOrientation}
        onGetLocation={handleGetLocation}
        onToggleHeatmap={toggleHeatmap}
        onToggleSections={toggleSections}
        onToggleRoutes={() => setShowRoutes((prev) => !prev)}
      />

      {/* Attribution */}
      <View style={[styles.attribution, { bottom: insets.bottom + 8 }]}>
        <Text style={styles.attributionText}>{attributionText}</Text>
      </View>

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
    right: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: spacing.xs,
  },
  attributionText: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
});
