import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useTheme } from '@/hooks';
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  CircleLayer,
  SymbolLayer,
  RasterSource,
  RasterLayer,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, shadows, brand } from '@/theme';
import { getActivityTypeConfig } from './ActivityTypeFilter';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { ComponentErrorBoundary } from '@/components/ui';
import {
  type MapStyleType,
  getMapStyle,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
} from './mapStyles';
import { computeAttribution } from '@/lib/maps/computeAttribution';
import type { ActivityBoundsItem } from '@/types';
import { useEngineSections, useRouteSignatures } from '@/hooks/routes';
import { HEATMAP_TILE_URL_TEMPLATE } from '@/hooks/maps/useHeatmapTiles';
import { useSectionAutoToggle, useVisibilityToggles } from '@/hooks/maps';
import { buildSpiderGeoJSON } from '@/lib/maps/buildSpiderGeoJSON';
import { isHeatmapEnabled } from '@/providers/RouteSettingsStore';
import type { FrequentSection } from '@/types';
import {
  ActivityPopup,
  SectionPopup,
  MapControlStack,
  ClusterCountOverlay,
  type ClusterCountOverlayRef,
  useMapHandlers,
  useMapCamera,
  useMapGeoJSON,
  useIOSTapHandler,
  type SelectedActivity,
  type SpiderState,
} from './regional';

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// Stable no-op function reference for disabled callbacks.
// Inline `() => {}` creates a new reference every render, which destabilises
// useCallback dependency chains and causes Android MapLibre camera snap-back.
const NOOP = () => {};

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
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = systemIsDark ? 'dark' : 'light';
  const [mapStyle, setMapStyle] = useState<MapStyleType>(systemStyle);
  const [selected, setSelected] = useState<SelectedActivity | null>(null);
  const {
    showActivities,
    showHeatmap,
    showSections,
    is3DMode,
    setShowActivities,
    setShowSections,
    setIs3DMode,
    toggleHeatmap,
    toggle3D,
  } = useVisibilityToggles();
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [visibleActivityIds, setVisibleActivityIds] = useState<Set<string> | null>(null);
  const [selectedSection, setSelectedSection] = useState<FrequentSection | null>(null);
  const [spider, setSpider] = useState<SpiderState | null>(null);
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);
  const clusterSourceRef = useRef<React.ElementRef<typeof ShapeSource>>(null);

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
  // useEngineSections loads full section data from Rust engine including polylines.
  // minVisits: 1 surfaces every detected section; the global map should show
  // all sections regardless of repeat-count.
  const { sections } = useEngineSections({
    minVisits: 1,
    enabled: showSections,
  });

  // Camera, bounds, and pre-computed activity centers
  const { activityCenters, mapCenter, currentZoomRef, currentCenterRef, markUserInteracted } =
    useMapCamera({ activities, routeSignatures, mapKey, cameraRef });

  // Trace zoom threshold — passed to handlers for zoom tracking but visibility
  // is handled by native minZoomLevel on layers (not React state) to avoid
  // re-renders that cause Android MapLibre camera snap-back.
  const TRACE_ZOOM_THRESHOLD = 11;
  const mapRef = useRef<React.ElementRef<typeof MapView>>(null);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const clusterOverlayRef = useRef<ClusterCountOverlayRef>(null);
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

  // Camera position for satellite attribution (updated by onCameraSettled callback, not on every gesture)
  const [cameraForAttribution, setCameraForAttribution] = useState<{
    center: [number, number];
    zoom: number;
  } | null>(null);

  // Initialize satellite attribution from mapCenter when activities load
  useEffect(() => {
    if (mapCenter && !cameraForAttribution) {
      setCameraForAttribution({
        center: mapCenter,
        zoom: currentZoomRef.current,
      });
    }
  }, [mapCenter, cameraForAttribution, currentZoomRef]);

  // Stable callback for camera settle notifications (uses ref to avoid dep changes)
  const mapStyleRef = useRef(mapStyle);
  mapStyleRef.current = mapStyle;
  const handleCameraSettled = useCallback((center: [number, number], zoom: number) => {
    if (mapStyleRef.current === 'satellite') {
      setCameraForAttribution({ center, zoom });
    }
  }, []);

  // Dynamic attribution based on visible satellite sources at current location.
  // Shared with ActivityMapView via `computeAttribution` so both maps stay in sync
  // when tile sources or satellite attribution rules change.
  const attributionText = useMemo(
    () =>
      computeAttribution({
        style: mapStyle,
        is3D: is3DMode,
        center: cameraForAttribution?.center ?? null,
        zoom: cameraForAttribution?.zoom ?? 0,
      }),
    [mapStyle, cameraForAttribution, is3DMode]
  );

  // Notify parent when attribution changes
  useEffect(() => {
    onAttributionChange?.(attributionText);
  }, [attributionText, onAttributionChange]);

  // Native MapLibre Supercluster handles large point counts efficiently (1000+).
  // JS-side viewport culling creates new array references via .filter() that cascade
  // through all GeoJSON builders, causing render loops via onRegionDidChange on Android.
  // Only enable for very large datasets where trace rendering is the bottleneck.
  const VIEWPORT_CULLING_THRESHOLD = 2000;
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

  // All GeoJSON data for map layers
  const {
    markersGeoJSON,
    tracesGeoJSON,
    startPointsGeoJSON,
    sectionsGeoJSON,
    userLocationGeoJSON,
    routeGeoJSON,
    routeHasData,
  } = useMapGeoJSON({
    allActivities: activities,
    visibleActivities,
    activityCenters,
    routeSignatures,
    sections,
    routeGroups: [],
    showRoutes: false,
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
    handleClusterOrMarkerPress,
    handleSpiderMarkerPress,
    handleMapPress,
    handleSectionPress,
    handleRegionIsChanging,
    handleRegionDidChange: baseHandleRegionDidChange,
    handleGetLocation,
    toggleActivities,
    toggleSections: baseToggleSections,
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
    showRoutes: false,
    setShowRoutes: NOOP,
    setSelectedRoute: NOOP,
    userLocation,
    setUserLocation,
    setLocationLoading,
    setVisibleActivityIds,
    currentZoomRef,
    currentCenterRef,
    setAboveTraceZoom: NOOP, // No-op: visibility handled by native minZoomLevel
    traceZoomThreshold: TRACE_ZOOM_THRESHOLD,
    onCameraSettled: handleCameraSettled,
    cameraRef,
    clusterSourceRef,
    map3DRef,
    bearingAnim,
    currentZoomLevel,
    is3DMode,
    markUserInteracted,
    setSpider,
  });

  // Auto-show sections when zoomed in to neighborhood level, auto-hide when zoomed out.
  // Manual toggles (via the control button) take precedence and disable auto-behavior.
  const { handleRegionDidChange: autoToggleHandleRegionDidChange, toggleSections } =
    useSectionAutoToggle({
      showSections,
      setShowSections,
      baseHandleRegionDidChange,
      baseToggleSections,
    });

  // Wrap the region-change handler to also refresh the cluster-count overlay.
  // MapLibre's native SymbolLayer renders cluster counts in bitmap form — those
  // glyphs are invisible to accessibility tools (Maestro, TalkBack). The React
  // overlay (`<ClusterCountOverlay>`) queries the rendered cluster features and
  // places matching Text nodes at the same screen positions, giving tests and
  // assistive tech an accessible handle on cluster counts.
  const handleRegionDidChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      autoToggleHandleRegionDidChange(e);
      clusterOverlayRef.current?.refresh();
    },
    [autoToggleHandleRegionDidChange]
  );

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

  // Toggle map style (cycles through light → dark → satellite)
  const toggleStyle = () => {
    setMapStyle((current) => getNextStyle(current));
  };

  // Handle 3D section click — receives section ID string, looks up section to select
  const handle3DSectionClick = useCallback(
    (sectionId: string) => {
      const section = sections.find((s) => s.id === sectionId);
      if (section) {
        setSelectedSection(section);
      }
    },
    [sections]
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

  // Spider GeoJSON for cluster fan-out at max zoom
  const { spiderPointsGeoJSON, spiderLinesGeoJSON } = useMemo(() => {
    if (!spider) {
      return {
        spiderPointsGeoJSON: EMPTY_FEATURE_COLLECTION,
        spiderLinesGeoJSON: EMPTY_FEATURE_COLLECTION,
      };
    }
    const { points, lines } = buildSpiderGeoJSON(spider, currentZoomRef.current);
    return { spiderPointsGeoJSON: points, spiderLinesGeoJSON: lines };
  }, [spider, currentZoomRef]);

  // 3D is available when we have any activities (terrain can be shown without a specific route)
  const can3D = activities.length > 0;
  // Show 3D view when enabled
  const show3D = is3DMode && can3D;

  // ========================================================================
  // Memoized marker style objects
  // ------------------------------------------------------------------------
  // Inline style={{...}} objects are a fresh reference every render, which
  // causes MapLibre to diff and re-apply layer styles even when nothing
  // changed. Memoising each distinct marker-layer style object keeps
  // references stable across renders when their dependencies haven't changed.
  // ========================================================================

  const clusterCircleStyle = useMemo(
    () => ({
      circleColor: colors.primary,
      circleRadius: [
        'step',
        ['get', 'point_count'],
        20, // <10 activities
        10,
        25, // 10-49
        50,
        30, // 50+
      ] as unknown as number,
      circleOpacity: showActivities ? 0.8 : 0,
    }),
    [showActivities]
  );

  const clusterCountStyle = useMemo(
    () => ({
      textField: ['get', 'point_count_abbreviated'] as unknown as string,
      textFont: ['Noto Sans Regular'],
      textSize: 12,
      textColor: '#FFFFFF',
      textAllowOverlap: true,
      textIgnorePlacement: true,
      visibility: (showActivities ? 'visible' : 'none') as 'visible' | 'none',
    }),
    [showActivities]
  );

  const unclusteredPointStyle = useMemo(
    () => ({
      circleColor: ['get', 'color'] as unknown as string,
      circleRadius: selectedActivityId
        ? ([
            'case',
            ['==', ['get', 'id'], selectedActivityId],
            12, // Selected: larger
            8,
          ] as unknown as number)
        : 8,
      // Recency fade: recent activities full opacity, 1+ year old at 35%
      circleOpacity: showActivities
        ? (['interpolate', ['linear'], ['get', 'age'], 0, 1, 1, 0.35] as unknown as number)
        : 0,
      circleStrokeWidth: selectedActivityId
        ? (['case', ['==', ['get', 'id'], selectedActivityId], 2.5, 1.5] as unknown as number)
        : 1.5,
      circleStrokeColor: selectedActivityId
        ? ([
            'case',
            ['==', ['get', 'id'], selectedActivityId],
            colors.primary,
            'rgba(255, 255, 255, 0.8)',
          ] as unknown as string)
        : 'rgba(255, 255, 255, 0.8)',
      circleStrokeOpacity: showActivities ? 1 : 0,
    }),
    [selectedActivityId, showActivities]
  );

  const startPointStyle = useMemo(
    () => ({
      circleRadius: 5,
      circleColor: ['get', 'color'] as unknown as string,
      circleOpacity: showActivities ? 0.9 : 0,
      circleStrokeWidth: 1.5,
      circleStrokeColor: '#FFFFFF',
      circleStrokeOpacity: showActivities ? 1 : 0,
    }),
    [showActivities]
  );

  const spiderLinesStyle = useMemo(
    () => ({
      lineColor: isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.3)',
      lineWidth: 1.5,
      lineOpacity: spider ? 1 : 0,
    }),
    [isDark, spider]
  );

  const spiderPointsStyle = useMemo(
    () => ({
      circleColor: ['get', 'color'] as unknown as string,
      circleRadius: 10,
      circleOpacity: spider ? 1 : 0,
      circleStrokeWidth: 2,
      circleStrokeColor: '#FFFFFF',
      circleStrokeOpacity: spider ? 1 : 0,
    }),
    [spider]
  );

  const userLocationOuterStyle = useMemo(
    () => ({
      circleRadius: 12,
      circleColor: colors.primary,
      circleOpacity: userLocation ? 0.3 : 0,
      circleStrokeWidth: 0,
    }),
    [userLocation]
  );

  const userLocationInnerStyle = useMemo(
    () => ({
      circleRadius: 6,
      circleColor: colors.primary,
      circleOpacity: userLocation ? 1 : 0,
      circleStrokeWidth: 2,
      circleStrokeColor: colors.textOnDark,
    }),
    [userLocation]
  );

  // iOS tap handling (no-op on Android)
  const { onTouchStart, onTouchEnd } = useIOSTapHandler({
    mapRef,
    activities,
    sections,
    routeGroups: [],
    selected,
    selectedSection,
    selectedRoute: null,
    setSelected,
    setSelectedSection,
    setSelectedRoute: NOOP,
    showActivities,
    showSections,
    showRoutes: false,
    show3D,
    handleMarkerTap,
    clusterSourceRef,
    cameraRef,
    currentZoomLevel,
    insetTop: insets.top,
    spider,
    setSpider,
  });

  return (
    <View style={styles.container} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {show3D ? (
        <ComponentErrorBoundary
          componentName="3D Map"
          showRetry={false}
          onError={() => setIs3DMode(false)}
        >
          <Map3DWebView
            ref={map3DRef}
            coordinates={route3DCoords.length > 0 ? route3DCoords : undefined}
            mapStyle={mapStyle}
            routeColor={selected ? getActivityTypeConfig(selected.activity.type).color : undefined}
            initialCenter={currentCenterRef.current ?? mapCenter ?? undefined}
            initialZoom={currentZoomRef.current}
            sectionsGeoJSON={showSections ? (sectionsGeoJSON ?? undefined) : undefined}
            // In 3D mode, use showActivities directly (no zoom check - 3D doesn't track zoom)
            tracesGeoJSON={showActivities ? (tracesGeoJSON ?? undefined) : undefined}
            showHeatmap={showHeatmap}
            onSectionClick={handle3DSectionClick}
          />
        </ComponentErrorBoundary>
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
          {/* No defaultSettings: Android MapLibre re-applies it on every render, causing snapback. */}
          {/* Initial positioning is done imperatively via fitBounds in useMapCamera.markUserInteracted. */}
          {/* CRITICAL: followUserLocation must be explicitly false to prevent auto-centering */}
          <Camera ref={cameraRef} followUserLocation={false} />

          {/* Activity markers — clustered ShapeSource with native MapLibre clustering */}
          {/* Replaces individual MarkerViews for better performance (GPU-rendered) */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS crash during view reconciliation */}
          <ShapeSource
            ref={clusterSourceRef}
            id="activity-clusters"
            shape={markersGeoJSON}
            cluster={true}
            clusterRadius={50}
            clusterMaxZoomLevel={14}
            onPress={
              Platform.OS === 'android' && showActivities ? handleClusterOrMarkerPress : undefined
            }
            hitbox={{ width: 44, height: 44 }}
          >
            {/* Cluster circles — primary color, radius scales by count */}
            <CircleLayer
              id="cluster-circles"
              filter={['has', 'point_count']}
              style={clusterCircleStyle}
            />
            {/* Cluster count labels — textFont MUST match glyph server (Noto Sans) */}
            <SymbolLayer
              id="cluster-count"
              filter={['has', 'point_count']}
              style={clusterCountStyle}
            />
            {/* Individual unclustered activity points — colored by sport type */}
            {/* Only visible at zoom >= 10 to keep low-zoom view clean (clusters only) */}
            <CircleLayer
              id="unclustered-point"
              filter={['!', ['has', 'point_count']]}
              minZoomLevel={10}
              style={unclusteredPointStyle}
            />
          </ShapeSource>

          {/* Sections layer - frequent road/trail sections (primary content on global map) */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash */}
          <ShapeSource
            id="sections"
            testID="regional-map-sections-overlay"
            shape={sectionsGeoJSON}
            onPress={handleSectionPress}
            hitbox={{ width: 44, height: 44 }}
          >
            <LineLayer
              id="sectionsLine"
              style={{
                lineColor: ['get', 'color'],
                lineWidth: selectedSection
                  ? [
                      'case',
                      ['==', ['get', 'id'], selectedSection.id],
                      10, // Bold when selected
                      6,
                    ]
                  : ['interpolate', ['linear'], ['zoom'], 6, 3, 10, 5, 14, 7, 18, 9],
                lineOpacity: showSections
                  ? selectedSection
                    ? ([
                        'case',
                        ['==', ['get', 'id'], selectedSection.id],
                        1,
                        0.6, // Dim unselected to make selected pop
                      ] as unknown as number)
                    : 1
                  : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            {/* Section outline — white border for contrast on any map style */}
            <LineLayer
              id="sectionsOutline"
              style={{
                lineColor: selectedSection
                  ? [
                      'case',
                      ['==', ['get', 'id'], selectedSection.id],
                      '#FFFFFF',
                      'rgba(255,255,255,0.4)',
                    ]
                  : '#FFFFFF',
                lineWidth: selectedSection
                  ? [
                      'case',
                      ['==', ['get', 'id'], selectedSection.id],
                      14, // Wide glow behind selected section
                      7,
                    ]
                  : ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 8, 18, 10],
                lineOpacity: showSections
                  ? selectedSection
                    ? [
                        'case',
                        ['==', ['get', 'id'], selectedSection.id],
                        0.8, // Bright glow when selected
                        0.35,
                      ]
                    : 0.55
                  : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              belowLayerID="sectionsLine"
            />
          </ShapeSource>

          {/* Raster heatmap tiles — only rendered when heatmap generation is enabled */}
          {isHeatmapEnabled() && (
            <RasterSource
              id="heatmap-tiles"
              tileUrlTemplates={[HEATMAP_TILE_URL_TEMPLATE]}
              minZoomLevel={0}
              maxZoomLevel={17}
              tileSize={256}
            >
              <RasterLayer
                id="heatmap-layer"
                style={{
                  rasterOpacity: showHeatmap ? (mapStyle === 'light' ? 0.92 : 0.72) : 0,
                  rasterContrast: mapStyle === 'light' ? 0.45 : 0,
                  rasterBrightnessMax: mapStyle === 'light' ? 0.55 : 1,
                  rasterSaturation: mapStyle === 'light' ? 0.6 : 0,
                  rasterResampling: 'linear',
                  rasterFadeDuration: 0,
                }}
                belowLayerID="cluster-circles"
              />
            </RasterSource>
          )}

          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash */}
          {/* Vector traces fully replaced by raster heatmap — no LineLayer needed */}
          {/* ShapeSource kept mounted (empty) to prevent Fabric view reconciliation crash */}
          <ShapeSource id="activity-traces" shape={tracesGeoJSON} />

          {/* Activity start-point markers — small dots at the first GPS coordinate */}
          {/* Visible when zoomed in past trace threshold and activities are shown */}
          {/* Start-point markers: use native minZoomLevel instead of React state
              to avoid re-renders that cause Android MapLibre camera snap-back */}
          <ShapeSource id="activity-start-points" shape={startPointsGeoJSON}>
            <CircleLayer id="start-point-outer" minZoomLevel={11} style={startPointStyle} />
          </ShapeSource>

          {/* Selected activity route */}
          {/* CRITICAL: Always render with fixed ID to avoid iOS MapLibre crash */}
          <ShapeSource id="selected-route" shape={routeGeoJSON}>
            {/* Dark casing + brand-orange trace when heatmap is on (sport colors blend into teal) */}
            <LineLayer
              id="selected-routeOutline"
              style={{
                lineColor: 'rgba(0, 0, 0, 0.4)',
                lineWidth: 8,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: routeHasData ? 1 : 0,
              }}
            />
            <LineLayer
              id="selected-routeLine"
              style={{
                lineColor: selected
                  ? isHeatmapEnabled() && showActivities
                    ? brand.orange
                    : getActivityTypeConfig(selected.activity.type).color
                  : '#000',
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: routeHasData ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* Spider fan-out layers — show when a cluster can't expand further at max zoom */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS crash during reconciliation */}
          <ShapeSource id="spider-legs" shape={spiderLinesGeoJSON}>
            <LineLayer id="spider-lines" style={spiderLinesStyle} />
          </ShapeSource>
          <ShapeSource
            id="spider-markers"
            shape={spiderPointsGeoJSON}
            onPress={Platform.OS === 'android' && spider ? handleSpiderMarkerPress : undefined}
            hitbox={{ width: 44, height: 44 }}
          >
            <CircleLayer id="spider-points" style={spiderPointsStyle} />
          </ShapeSource>

          {/* User location marker - using ShapeSource + CircleLayer to avoid Fabric crash */}
          {/* CRITICAL: Always render to prevent add/remove cycles that crash iOS */}
          <ShapeSource id="user-location" shape={userLocationGeoJSON}>
            <CircleLayer id="user-location-outer" style={userLocationOuterStyle} />
            <CircleLayer id="user-location-inner" style={userLocationInnerStyle} />
          </ShapeSource>
        </MapView>
      )}

      {/* Accessibility + test-ID overlay for cluster counts (invisible to users;
          the native SymbolLayer above renders the visible glyphs). */}
      {!show3D && <ClusterCountOverlay mapRef={mapRef} ref={clusterOverlayRef} />}

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
        showHeatmap={showHeatmap}
        showSections={showSections}
        showRoutes={false}
        userLocationActive={!!userLocation}
        locationLoading={locationLoading}
        sections={sections}
        routeCount={0}
        activityCount={activities.length}
        bearingAnim={bearingAnim}
        onToggle3D={toggle3D}
        onResetOrientation={resetOrientation}
        onGetLocation={handleGetLocation}
        onToggleActivities={toggleActivities}
        onToggleHeatmap={isHeatmapEnabled() ? toggleHeatmap : undefined}
        onToggleSections={toggleSections}
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
