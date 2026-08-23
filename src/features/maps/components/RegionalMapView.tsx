import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, shadows } from '@/theme';
import { getActivityTypeConfig } from './ActivityTypeFilter';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { ComponentErrorBoundary } from '@/shared/ui';
import { type MapStyleType, isDarkStyle, getNextStyle, getStyleIcon } from './mapStyles';
import { MapSurface, type MapCameraState, type MapSurfaceRef } from './MapSurface';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import type { ActivityBoundsItem, FrequentSection } from '@/types';
import {
  useEngineSections,
  useEngineSectionCount,
  useRouteSignatures,
} from '@/features/routes/hooks';
import { useSectionAutoToggle, useVisibilityToggles } from '@/features/maps/hooks';
import { TRACE_ZOOM_THRESHOLD, VIEWPORT_CULLING_THRESHOLD } from '@/features/maps/lib/mapBudgets';
import { buildSpiderGeoJSON } from '@/features/maps/lib/buildSpiderGeoJSON';
import { isHeatmapEnabled } from '@/features/routes/stores/RouteSettingsStore';
import {
  ActivityPopup,
  SectionPopup,
  MapControlStack,
  ClusterCountOverlay,
  type ClusterCountOverlayRef,
  useMapHandlers,
  useMapCamera,
  useMapGeoJSON,
  type SelectedActivity,
  type SpiderState,
} from './regional';
import {
  buildRegionalLayers,
  buildRegionalSources,
  HEATMAP_ROUTE_COLOR,
  REGIONAL_INTERACTIVE_LAYERS,
} from './regional/regionalMapLayerSpecs';

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const SURFACE_STYLE_OPTIONS = { bundledLightStyle: true, cacheVectorTiles: true } as const;

/** World view until the camera hook fits the activities it finds. */
const WORLD_CAMERA = { center: [0, 0] as [number, number], zoom: 2 };

// Stable no-op function reference for disabled callbacks.
// Inline `() => {}` creates a new reference every render, which destabilises
// useCallback dependency chains and causes Android MapLibre camera snap-back.
const NOOP = () => {};

/**
 * Global map of every activity, clustered.
 *
 * Three things keep pan and zoom smooth with thousands of points:
 *
 * 1. Activity centres are computed once in useMapCamera, from the Rust-side
 *    RouteSignature where one exists, so no format detection runs per frame.
 *
 * 2. The marker and trace collections never depend on selection. Selection is
 *    a paint expression over the selected id, so choosing an activity does not
 *    re-upload the point set.
 *
 * 3. Above VIEWPORT_CULLING_THRESHOLD activities, a spatial index narrows the
 *    set to the viewport. Below it, culling costs more than it saves.
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
  const surfaceRef = useRef<MapSurfaceRef>(null);

  // Only load route signatures when the map tab is focused
  // This prevents 80+ getGpsTrack FFI calls when switching to other tabs
  const pathname = usePathname();
  const isMapFocused = pathname === '/map' || pathname.endsWith('/map');
  const routeSignatures = useRouteSignatures(isMapFocused);

  // Cheap section count (SQL COUNT, no polylines) drives the toggle button's
  // visibility so it appears from first paint without the heavy polyline load.
  const sectionCount = useEngineSectionCount();

  // Frequent sections from route matching (with polylines loaded).
  // minVisits: 1 surfaces every detected section; the global map should show
  // all sections regardless of repeat-count.
  // Gated on showSections: the polylines are only needed when the sections
  // layer is visible (2D overlay or 3D sectionsGeoJSON). The toggle button no
  // longer depends on this load - it reads sectionCount - so gating here can't
  // deadlock the button. The auto-toggle flips showSections on when zoomed in,
  // which triggers the load on demand.
  const { sections } = useEngineSections({
    minVisits: 1,
    enabled: showSections,
  });

  // Camera, bounds, and pre-computed activity centers
  const { activityCenters, mapCenter, currentZoomRef, currentCenterRef, markUserInteracted } =
    useMapCamera({ activities, routeSignatures, surfaceRef });

  const map3DRef = useRef<Map3DWebViewRef>(null);
  const clusterOverlayRef = useRef<ClusterCountOverlayRef>(null);
  const bearingAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return () => {
      bearingAnim.stopAnimation();
    };
  }, [bearingAnim]);

  // ===========================================
  // GESTURE TRACKING - For compass updates
  // ===========================================
  const currentZoomLevel = useRef(10); // Track current zoom for compass updates

  const isDark = isDarkStyle(mapStyle);

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

  // Clustering handles large point counts on its own. Culling below the
  // threshold just churns array references through every GeoJSON builder.
  const visibleActivities = useMemo(() => {
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
    handleSurfacePress,
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
    setAboveTraceZoom: NOOP, // Visibility is a zoom expression on the layer
    traceZoomThreshold: TRACE_ZOOM_THRESHOLD,
    onCameraSettled: handleCameraSettled,
    surfaceRef,
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
  // The map draws cluster counts as glyphs inside the WebView canvas, which no
  // accessibility tool can see. The overlay asks the page which clusters are
  // drawn and where, then places matching nodes over them.
  const handleRegionDidChange = useCallback(
    (state: MapCameraState) => {
      autoToggleHandleRegionDidChange(state);
      clusterOverlayRef.current?.refresh();
    },
    [autoToggleHandleRegionDidChange]
  );

  // Clear selections when their corresponding group visibility is turned off.
  // Spider expansion (cluster fan-out) is part of the activities layer - when
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

  // Handle 3D section click - receives section ID string, looks up section to select
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

  const heatmapEnabled = isHeatmapEnabled();

  const sources = useMemo(
    () =>
      buildRegionalSources({
        markersGeoJSON,
        tracesGeoJSON,
        startPointsGeoJSON,
        sectionsGeoJSON,
        userLocationGeoJSON,
        routeGeoJSON,
        spiderPointsGeoJSON,
        spiderLinesGeoJSON,
        heatmapEnabled,
      }),
    [
      markersGeoJSON,
      tracesGeoJSON,
      startPointsGeoJSON,
      sectionsGeoJSON,
      userLocationGeoJSON,
      routeGeoJSON,
      spiderPointsGeoJSON,
      spiderLinesGeoJSON,
      heatmapEnabled,
    ]
  );

  // Sport colours wash out against the teal heatmap, so the selected route
  // switches to the brand tint while the heatmap is drawn underneath it.
  const selectedRouteColor = selected
    ? heatmapEnabled && showActivities
      ? HEATMAP_ROUTE_COLOR
      : getActivityTypeConfig(selected.activity.type).color
    : colors.textPrimary;

  const layers = useMemo(
    () =>
      buildRegionalLayers({
        isDark,
        mapStyle,
        showActivities,
        showSections,
        showHeatmap,
        heatmapEnabled,
        hasSpider: !!spider,
        hasUserLocation: !!userLocation,
        hasRouteData: routeHasData,
        selectedActivityId,
        selectedSectionId: selectedSection?.id ?? null,
        routeColor: selectedRouteColor,
      }),
    [
      isDark,
      mapStyle,
      showActivities,
      showSections,
      showHeatmap,
      heatmapEnabled,
      spider,
      userLocation,
      routeHasData,
      selectedActivityId,
      selectedSection,
      selectedRouteColor,
    ]
  );

  return (
    <View style={styles.container}>
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
        <MapSurface
          ref={surfaceRef}
          mapStyle={mapStyle}
          styleOptions={SURFACE_STYLE_OPTIONS}
          initialCamera={WORLD_CAMERA}
          sources={sources}
          layers={layers}
          interactiveLayers={REGIONAL_INTERACTIVE_LAYERS}
          serveHeatmapTiles={heatmapEnabled}
          onMapReady={markUserInteracted}
          onPress={handleSurfacePress}
          onRegionIsChanging={handleRegionIsChanging}
          onRegionDidChange={handleRegionDidChange}
        />
      )}

      {/* Accessibility and test handle for cluster counts. Invisible to users -
          the map draws the glyphs itself, inside a canvas nothing else can see. */}
      {!show3D && <ClusterCountOverlay surfaceRef={surfaceRef} ref={clusterOverlayRef} />}

      {/* Same idea for the sections layer: something outside the canvas that
          says whether sections are currently drawn. */}
      {!show3D && showSections && (
        <View
          testID="regional-map-sections-overlay"
          accessibilityLabel={t('maps.showSections')}
          style={styles.layerMarker}
          pointerEvents="none"
        />
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
        showHeatmap={showHeatmap}
        showSections={showSections}
        showRoutes={false}
        userLocationActive={!!userLocation}
        locationLoading={locationLoading}
        sectionCount={sectionCount}
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
      {/* Selected activity popup - sits just above the bottom info bar
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
      {/* Section popup - same vertical anchor as ActivityPopup. */}
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
  layerMarker: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
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
