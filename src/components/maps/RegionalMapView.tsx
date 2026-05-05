import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useMapPreferences } from '@/providers';
import {
  Map as MLMap,
  Camera,
  GeoJSONSource,
  Layer,
  RasterSource,
  type CameraRef,
  type GeoJSONSourceRef,
  type MapRef,
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
  const { getGlobalMapStyle, setGlobalMapStyle } = useMapPreferences();
  const insets = useSafeAreaInsets();
  const [mapStyle, setMapStyleLocal] = useState<MapStyleType>(getGlobalMapStyle());
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
  const cameraRef = useRef<CameraRef>(null);
  const clusterSourceRef = useRef<GeoJSONSourceRef>(null);

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
  // Always load so the toggle button is visible from first paint — gating on
  // showSections deadlocks the button (button needs sections.length > 0 to
  // appear, but sections won't load until the user toggles it on).
  const { sections } = useEngineSections({
    minVisits: 1,
    enabled: true,
  });

  // Camera, bounds, and pre-computed activity centers
  const { activityCenters, mapCenter, currentZoomRef, currentCenterRef, markUserInteracted } =
    useMapCamera({ activities, routeSignatures, mapKey, cameraRef });

  // Trace zoom threshold — passed to handlers for zoom tracking but visibility
  // is handled by native minZoomLevel on layers (not React state) to avoid
  // re-renders that cause Android MapLibre camera snap-back.
  const TRACE_ZOOM_THRESHOLD = 11;
  const mapRef = useRef<MapRef>(null);
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

  // Clear selections when their corresponding group visibility is turned off.
  // Spider expansion (cluster fan-out) is part of the activities layer — when
  // activities are hidden, the spider markers/legs must clear too, otherwise
  // they linger and look like rogue activity markers.
  useEffect(() => {
    if (!showActivities) {
      if (selected) setSelected(null);
      if (spider) setSpider(null);
    }
  }, [showActivities, selected, spider]);

  useEffect(() => {
    if (!showSections && selectedSection) {
      setSelectedSection(null);
    }
  }, [showSections, selectedSection]);

  const toggleStyle = () => {
    setMapStyleLocal((current) => {
      const next = getNextStyle(current);
      setGlobalMapStyle(next);
      return next;
    });
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
      visibility: (showActivities ? 'visible' : 'none') as 'visible' | 'none',
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
      visibility: (showActivities ? 'visible' : 'none') as 'visible' | 'none',
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
      visibility: (showActivities ? 'visible' : 'none') as 'visible' | 'none',
    }),
    [showActivities]
  );

  const spiderLinesStyle = useMemo(
    () => ({
      lineColor: isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.3)',
      lineWidth: 1.5,
      lineOpacity: spider && showActivities ? 1 : 0,
      visibility: (spider && showActivities ? 'visible' : 'none') as 'visible' | 'none',
    }),
    [isDark, spider, showActivities]
  );

  const spiderPointsStyle = useMemo(
    () => ({
      circleColor: ['get', 'color'] as unknown as string,
      circleRadius: 10,
      circleOpacity: spider && showActivities ? 1 : 0,
      circleStrokeWidth: 2,
      circleStrokeColor: '#FFFFFF',
      circleStrokeOpacity: spider && showActivities ? 1 : 0,
      visibility: (spider && showActivities ? 'visible' : 'none') as 'visible' | 'none',
    }),
    [spider, showActivities]
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
            // Pass an empty FeatureCollection (not undefined) when toggled off
            // so the WebView clears the previous data via setData; undefined
            // leaves the layer's last value cached and visible.
            sectionsGeoJSON={
              showSections
                ? (sectionsGeoJSON ?? EMPTY_FEATURE_COLLECTION)
                : EMPTY_FEATURE_COLLECTION
            }
            // Global map in 3D mirrors the 2D paradigm: only points, never the
            // full activity polylines. tracesGeoJSON is always empty here;
            // activity locations come through pointMarkersGeoJSON below as
            // colored circles per sport (no polylines).
            tracesGeoJSON={EMPTY_FEATURE_COLLECTION}
            pointMarkersGeoJSON={showActivities ? markersGeoJSON : EMPTY_FEATURE_COLLECTION}
            showHeatmap={showHeatmap}
            onSectionClick={handle3DSectionClick}
            onActivityClick={(activityId) => {
              const activity = activities.find((a) => a.id === activityId);
              if (activity) handleMarkerTap(activity);
            }}
          />
        </ComponentErrorBoundary>
      ) : (
        <MLMap
          key={`regional-map-${mapKey}`}
          ref={mapRef}
          style={styles.map}
          mapStyle={mapStyleValue}
          logo={false}
          attribution={false}
          compass={false}
          onPress={Platform.OS === 'android' ? handleMapPress : undefined}
          onRegionIsChanging={handleRegionIsChanging}
          onRegionDidChange={handleRegionDidChange}
          onDidFailLoadingMap={handleMapLoadError}
        >
          {/* Camera with ref for programmatic control */}
          {/* No initialViewState: Android MapLibre re-applies it on every render, causing snapback. */}
          {/* Initial positioning is done imperatively via fitBounds in useMapCamera.markUserInteracted. */}
          <Camera ref={cameraRef} />

          {/* Activity markers — clustered GeoJSONSource with native MapLibre clustering */}
          {/* CRITICAL: Always render GeoJSONSource to avoid iOS crash during view reconciliation */}
          <GeoJSONSource
            ref={clusterSourceRef}
            id="activity-clusters"
            data={markersGeoJSON}
            cluster={true}
            clusterRadius={50}
            clusterMaxZoom={14}
            onPress={
              Platform.OS === 'android' && showActivities ? handleClusterOrMarkerPress : undefined
            }
            hitbox={{ top: 22, right: 22, bottom: 22, left: 22 }}
          >
            {/* Cluster circles — primary color, radius scales by count */}
            <Layer
              type="circle"
              id="cluster-circles"
              filter={['has', 'point_count']}
              style={clusterCircleStyle}
            />
            {/* Cluster count labels — textFont MUST match glyph server (Noto Sans) */}
            <Layer
              type="symbol"
              id="cluster-count"
              filter={['has', 'point_count']}
              style={clusterCountStyle}
            />
            {/* Individual unclustered activity points — colored by sport type */}
            {/* Only visible at zoom >= 10 to keep low-zoom view clean (clusters only) */}
            <Layer
              type="circle"
              id="unclustered-point"
              filter={['!', ['has', 'point_count']]}
              minzoom={10}
              style={unclusteredPointStyle}
            />
          </GeoJSONSource>

          {/* Sections layer - frequent road/trail sections (primary content on global map) */}
          {/* CRITICAL: Always render GeoJSONSource to avoid iOS MapLibre crash */}
          <GeoJSONSource
            id="sections"
            testID="regional-map-sections-overlay"
            data={sectionsGeoJSON}
            onPress={handleSectionPress}
            hitbox={{ top: 22, right: 22, bottom: 22, left: 22 }}
          >
            {/* Thin dashed section line — matches the dashed traces used in the
                activity-detail map view. Width is intentionally modest so a
                long section doesn't dominate the screen. */}
            <Layer
              type="line"
              id="sectionsLine"
              style={{
                lineColor: ['get', 'color'],
                lineWidth: selectedSection
                  ? [
                      'case',
                      ['==', ['get', 'id'], selectedSection.id],
                      4, // Slight emphasis when selected
                      2,
                    ]
                  : ['interpolate', ['linear'], ['zoom'], 6, 1.2, 10, 1.8, 14, 2.4, 18, 3.2],
                lineDasharray: [2, 1.2],
                lineOpacity: showSections
                  ? selectedSection
                    ? ([
                        'case',
                        ['==', ['get', 'id'], selectedSection.id],
                        1,
                        0.55,
                      ] as unknown as number)
                    : 0.95
                  : 0,
                lineCap: 'butt',
                lineJoin: 'round',
              }}
            />
            {/* Subtle outline only when a section is selected — not on every
                section, otherwise the lines look bulky again. */}
            <Layer
              type="line"
              id="sectionsOutline"
              style={{
                lineColor: '#FFFFFF',
                lineWidth: selectedSection
                  ? (['case', ['==', ['get', 'id'], selectedSection.id], 6, 0] as unknown as number)
                  : 0,
                lineOpacity: selectedSection && showSections ? 0.8 : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              beforeId="sectionsLine"
            />
          </GeoJSONSource>

          {/* Raster heatmap tiles — only rendered when heatmap generation is enabled */}
          {isHeatmapEnabled() && (
            <RasterSource
              id="heatmap-tiles"
              tiles={[HEATMAP_TILE_URL_TEMPLATE]}
              minzoom={0}
              maxzoom={17}
              tileSize={256}
            >
              <Layer
                type="raster"
                id="heatmap-layer"
                style={{
                  rasterOpacity: showHeatmap ? (mapStyle === 'light' ? 0.92 : 0.72) : 0,
                  rasterContrast: mapStyle === 'light' ? 0.45 : 0,
                  rasterBrightnessMax: mapStyle === 'light' ? 0.55 : 1,
                  rasterSaturation: mapStyle === 'light' ? 0.6 : 0,
                  rasterResampling: 'linear',
                  rasterFadeDuration: 0,
                }}
                beforeId="cluster-circles"
              />
            </RasterSource>
          )}

          {/* CRITICAL: Always render GeoJSONSource to avoid iOS MapLibre crash */}
          {/* Vector traces fully replaced by raster heatmap — no Layer needed */}
          {/* GeoJSONSource kept mounted (empty) to prevent Fabric view reconciliation crash */}
          <GeoJSONSource id="activity-traces" data={tracesGeoJSON} />

          {/* Activity start-point markers — small dots at the first GPS coordinate */}
          {/* Visible when zoomed in past trace threshold and activities are shown */}
          {/* Start-point markers: use native minzoom instead of React state
              to avoid re-renders that cause Android MapLibre camera snap-back */}
          <GeoJSONSource id="activity-start-points" data={startPointsGeoJSON}>
            <Layer type="circle" id="start-point-outer" minzoom={11} style={startPointStyle} />
          </GeoJSONSource>

          {/* Selected activity route */}
          {/* CRITICAL: Always render with fixed ID to avoid iOS MapLibre crash */}
          <GeoJSONSource id="selected-route" data={routeGeoJSON}>
            {/* Dark casing + brand-orange trace when heatmap is on (sport colors blend into teal) */}
            <Layer
              type="line"
              id="selected-routeOutline"
              style={{
                lineColor: 'rgba(0, 0, 0, 0.4)',
                lineWidth: 8,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: routeHasData ? 1 : 0,
              }}
            />
            <Layer
              type="line"
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
          </GeoJSONSource>

          {/* Spider fan-out layers — show when a cluster can't expand further at max zoom */}
          {/* CRITICAL: Always render GeoJSONSource to avoid iOS crash during reconciliation */}
          <GeoJSONSource id="spider-legs" data={spiderLinesGeoJSON}>
            <Layer type="line" id="spider-lines" style={spiderLinesStyle} />
          </GeoJSONSource>
          <GeoJSONSource
            id="spider-markers"
            data={spiderPointsGeoJSON}
            onPress={Platform.OS === 'android' && spider ? handleSpiderMarkerPress : undefined}
            hitbox={{ top: 22, right: 22, bottom: 22, left: 22 }}
          >
            <Layer type="circle" id="spider-points" style={spiderPointsStyle} />
          </GeoJSONSource>

          {/* User location marker - using GeoJSONSource + circle Layer to avoid Fabric crash */}
          {/* CRITICAL: Always render to prevent add/remove cycles that crash iOS */}
          <GeoJSONSource id="user-location" data={userLocationGeoJSON}>
            <Layer type="circle" id="user-location-outer" style={userLocationOuterStyle} />
            <Layer type="circle" id="user-location-inner" style={userLocationInnerStyle} />
          </GeoJSONSource>
        </MLMap>
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
      {/* Selected activity popup — sits just above the bottom info bar
          (attribution pill + filter chips). Tuned to leave a small breathing
          gap above the attribution pill rather than the previous large
          floating-mid-screen position. */}
      {selected && (
        <ActivityPopup
          selected={selected}
          bottom={insets.bottom + 250}
          onZoom={handleZoomToActivity}
          onClose={handleClosePopup}
          onViewDetails={handleViewDetails}
        />
      )}
      {/* Section popup — same vertical anchor as ActivityPopup. */}
      {selectedSection && (
        <SectionPopup
          section={selectedSection}
          bottom={insets.bottom + 250}
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
