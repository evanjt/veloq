import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, shadows } from '@/theme';
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
import { useEngineSections, useRouteSignatures, useRouteGroups } from '@/hooks/routes';
import type { FrequentSection } from '@/types';
import {
  ActivityPopup,
  SectionPopup,
  RoutePopup,
  MapControlStack,
  getMarkerSize,
  useMapHandlers,
  useMapCamera,
  useMapGeoJSON,
  useIOSTapHandler,
  type SelectedActivity,
  type SelectedRoute,
} from './regional';

/**
 * 120Hz OPTIMIZATION SUMMARY:
 *
 * This component has been optimized for smooth 120fps pan/zoom by:
 *
 * 1. Pre-computed centers: Activity centers are computed once in useMapCamera
 *    (using Rust-computed centers from RouteSignature when available),
 *    avoiding getBoundsCenter() format detection during render.
 *
 * 2. Stable GeoJSON: markersGeoJSON and tracesGeoJSON no longer depend on
 *    selection state. Instead, MapLibre expressions use selectedActivityId
 *    directly, preventing GeoJSON rebuilds on selection change.
 *
 * 3. Stable marker order: MarkerViews are rendered in stable order to avoid
 *    iOS crash (NSRangeException in MLRNMapView insertReactSubview:atIndex:).
 *
 * 4. Viewport culling: Uses spatial index (R-tree) to filter activities
 *    to only those in current viewport before rendering.
 */
interface RegionalMapViewProps {
  /** Activities to display */
  activities: ActivityBoundsItem[];
  /** Extra bottom offset for attribution (e.g., when timeline slider is shown) */
  attributionBottomOffset?: number;
  /** Show attribution (default: true) */
  showAttribution?: boolean;
  /** Callback when attribution text changes */
  onAttributionChange?: (attribution: string) => void;
}

export function RegionalMapView({
  activities,
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
  const [showSections, setShowSections] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [visibleActivityIds, setVisibleActivityIds] = useState<Set<string> | null>(null);
  const [selectedSection, setSelectedSection] = useState<FrequentSection | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<SelectedRoute | null>(null);
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

  // Reset retry count when style changes or map remounts
  useEffect(() => {
    retryCountRef.current = 0;
  }, [mapStyle, mapKey]);

  // Only load route signatures when the map tab is focused
  // This prevents 80+ getGpsTrack FFI calls when switching to other tabs
  const pathname = usePathname();
  const isMapFocused = pathname === '/map' || pathname.endsWith('/map');
  const routeSignatures = useRouteSignatures(isMapFocused);

  // Frequent sections from route matching (with polylines loaded)
  // useEngineSections loads full section data from Rust engine including polylines
  // This fixes iOS crash when sectionsGeoJSON creates LineString with empty coordinates
  const { sections } = useEngineSections({ minVisits: 2, enabled: showSections });

  // Route groups for displaying routes on the map
  const { groups: routeGroups } = useRouteGroups({ minActivities: 2 });

  // Camera, bounds, and pre-computed activity centers
  const {
    activityCenters,
    mapCenter,
    mapZoom,
    currentCenter,
    currentZoom,
    setCurrentCenter,
    setCurrentZoom,
    initialCameraSettings,
  } = useMapCamera({ activities, routeSignatures, mapKey });

  // Show GPS traces when zoomed in past this level
  const TRACE_ZOOM_THRESHOLD = 11;
  const mapRef = useRef<React.ElementRef<typeof MapView>>(null);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const bearingAnim = useRef(new Animated.Value(0)).current;

  // ===========================================
  // GESTURE TRACKING - For compass updates
  // ===========================================
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

  // Filter activities to only those visible in viewport (for performance)
  // Only enable viewport culling for large activity counts to avoid marker flashing
  // With < 150 activities, showing all is fast enough and provides better UX
  const VIEWPORT_CULLING_THRESHOLD = 150;
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

  // GPS trace visibility: zoomed in + activities visible
  const showTraces = currentZoom >= TRACE_ZOOM_THRESHOLD && showActivities;

  // All GeoJSON data for map layers
  const {
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
  } = useMapGeoJSON({
    visibleActivities,
    activityCenters,
    routeSignatures,
    sections,
    routeGroups,
    showRoutes,
    userLocation,
    selected,
    t,
  });

  // Event handlers
  const {
    handleMarkerTap,
    handleClosePopup,
    handleViewDetails,
    handleZoomToActivity,
    handleMarkerPress,
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
  } = useMapHandlers({
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
    setCurrentZoom,
    setCurrentCenter,
    cameraRef,
    map3DRef,
    bearingAnim,
    currentZoomLevel,
    is3DMode,
  });

  // Clear selections when their corresponding group visibility is turned off
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

  // Handle route press - show route popup
  const handleRoutePress = useCallback(
    (event: { features?: GeoJSON.Feature[] }) => {
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

  // Selected activity ID for MapLibre expressions (cheap to pass, doesn't trigger GeoJSON rebuild)
  const selectedActivityId = selected?.activity.id ?? null;

  // Get 3D route coordinates from selected activity (if any)
  // Uses pre-computed routeCoords if available, falls back to mapData.latlngs
  // Filter NaN/Infinity to prevent invalid GeoJSON in Map3DWebView
  const route3DCoords = useMemo(() => {
    // Priority 1: Use pre-computed routeCoords (already in [lng, lat] format)
    if (selected?.routeCoords && selected.routeCoords.length > 0) {
      return selected.routeCoords;
    }

    // Priority 2: Fall back to mapData.latlngs
    if (!selected?.mapData?.latlngs) return [];

    return selected.mapData.latlngs
      .filter((c): c is [number, number] => c !== null)
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
      .map(([lat, lng]) => [lng, lat] as [number, number]); // Convert to [lng, lat]
  }, [selected?.routeCoords, selected?.mapData]);

  // 3D is available when we have any activities (terrain can be shown without a specific route)
  const can3D = activities.length > 0;
  // Show 3D view when enabled
  const show3D = is3DMode && can3D;

  // iOS tap handling (no-op on Android)
  const { onTouchStart, onTouchEnd } = useIOSTapHandler({
    mapRef,
    activities,
    sections,
    routeGroups,
    selected,
    selectedSection,
    selectedRoute,
    setSelected,
    setSelectedSection,
    setSelectedRoute,
    showActivities,
    showSections,
    showRoutes,
    show3D,
    handleMarkerTap,
    currentZoomLevel,
    insetTop: insets.top,
  });

  return (
    <View style={styles.container} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
          // In 3D mode, use showActivities directly (no zoom check - 3D doesn't track zoom)
          tracesGeoJSON={showActivities ? (tracesGeoJSON ?? undefined) : undefined}
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
        >
          {/* Camera with ref for programmatic control */}
          {/* ANDROID FIX: Only pass defaultSettings once to prevent re-centering on re-renders */}
          {/* CRITICAL: followUserLocation must be explicitly false to prevent auto-centering */}
          <Camera
            ref={cameraRef}
            defaultSettings={initialCameraSettings}
            animationDuration={0}
            followUserLocation={false}
          />

          {/* Activity markers - visual only, taps handled by ShapeSource rendered later */}
          {/* CRITICAL: Always render MarkerViews to avoid iOS crash during reconciliation */}
          {/* Use opacity to hide instead of conditional rendering */}
          {/* iOS CRASH FIX: Render ALL activities as MarkerViews (stable count) */}
          {activities.map((activity) => {
            const config = getActivityTypeConfig(activity.type);
            // Use pre-computed center (no format detection during render!)
            const center = activityCenters[activity.id];
            const size = getMarkerSize(activity.distance);
            const isSelected = selectedActivityId === activity.id;
            const markerSize = isSelected ? size + 8 : size;
            // Larger icon ratio to fill more of the marker
            const iconSize = isSelected ? size * 0.75 : size * 0.7;
            // Viewport culling via opacity - MarkerView stays mounted but hidden
            const isInViewport =
              activities.length < VIEWPORT_CULLING_THRESHOLD ||
              !visibleActivityIds ||
              visibleActivityIds.has(activity.id);
            const isVisible = showActivities && !!center && isInViewport;

            return (
              <MarkerView
                key={`marker-${activity.id}`}
                coordinate={center || [0, 0]}
                anchor={{ x: 0.5, y: 0.5 }}
                allowOverlap={true}
              >
                {/* pointerEvents="none" is CRITICAL for Android - Pressable breaks marker rendering */}
                <View
                  pointerEvents="none"
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
                  <MaterialCommunityIcons
                    name={config.icon}
                    size={iconSize}
                    color={colors.textOnDark}
                  />
                </View>
              </MarkerView>
            );
          })}

          {/* Activity marker hit detection - invisible circles for queryRenderedFeaturesAtPoint */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS crash during view reconciliation */}
          <ShapeSource
            id="activity-markers-hitarea"
            shape={markersGeoJSON}
            onPress={Platform.OS === 'android' && showActivities ? handleMarkerPress : undefined}
            hitbox={{ width: 36, height: 36 }}
          >
            {/* Invisible circles for hit detection - sized to match visual markers */}
            <CircleLayer
              id="marker-hitarea"
              style={{
                circleRadius: showActivities
                  ? [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      0,
                      16, // World view: modest hitarea
                      4,
                      14, // Continental
                      8,
                      12, // Regional
                      12,
                      8, // City level - smaller to not overlap markers
                      16,
                      6, // Neighborhood - minimal, just for touch tolerance
                    ]
                  : 0,
                circleColor: '#000000',
                // iOS requires higher opacity than Android to be queryable
                circleOpacity: showActivities
                  ? [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      0,
                      0.05, // World view - slightly visible for queryability
                      8,
                      0.03, // Regional - less visible
                      12,
                      0.02, // City level - barely visible
                      16,
                      0.01, // Neighborhood - nearly invisible
                    ]
                  : 0,
                circleStrokeWidth: 0,
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
                visibility: showRoutes ? 'visible' : 'none',
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
            <LineLayer
              id="sectionsLine"
              style={{
                lineColor: ['get', 'color'],
                // Note: zoom expressions cannot be nested inside case expressions
                lineWidth: selectedSection
                  ? [
                      'case',
                      ['==', ['get', 'id'], selectedSection.id],
                      8, // Bold when selected
                      4,
                    ]
                  : ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 18, 7],
                lineOpacity: showSections
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
                lineWidth: selectedSection
                  ? [
                      'case',
                      ['==', ['get', 'id'], selectedSection.id],
                      10, // Bold when selected
                      6,
                    ]
                  : ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7, 18, 9],
                lineOpacity: showSections
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

          {/* GPS traces - simplified routes shown when zoomed in */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash */}
          <ShapeSource id="activity-traces" shape={tracesGeoJSON}>
            <LineLayer
              id="tracesLine"
              style={{
                lineColor: ['get', 'color'],
                lineWidth: [
                  'case',
                  // Hide selected trace (full route shown instead)
                  ['==', ['get', 'id'], selectedActivityId ?? ''],
                  0,
                  2,
                ],
                // Fabric crash fix: Control visibility via opacity, not feature count
                lineOpacity: showTraces ? 0.4 : 0,
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
          {sectionMarkers.map((marker) => {
            const isVisible = showSections;
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
          {routeMarkers.map((marker) => {
            const isVisible = showRoutes;
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
        showActivities={showActivities}
        showSections={showSections}
        showRoutes={showRoutes}
        userLocationActive={!!userLocation}
        locationLoading={locationLoading}
        sections={sections}
        routeCount={routeGroups.length}
        activityCount={activities.length}
        bearingAnim={bearingAnim}
        onToggle3D={toggle3D}
        onResetOrientation={resetOrientation}
        onGetLocation={handleGetLocation}
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
  styleButton: {
    right: spacing.md,
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
