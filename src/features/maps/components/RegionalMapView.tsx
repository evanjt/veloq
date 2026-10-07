import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, shadows, colorWithOpacity, ink } from '@/theme';
import { getActivityTypeConfig } from '../lib/activityCategories';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { ComponentErrorBoundary } from '@/shared/ui';
import { type MapStyleType, isDarkStyle, getNextStyle, getStyleIcon } from './mapStyles';
import { MapSurface, type MapCameraState, type MapSurfaceRef } from './MapSurface';
import { useDrawnMapStyle } from '@/features/maps/hooks/useDrawnMapStyle';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import type { ActivityBoundsItem } from '@/types';
import { useSectionDetail } from '@/shared/native/useSectionDetail';
import type { MapSection } from '@/features/maps/hooks/useEngineMapActivities';
import { useSectionAutoToggle, useVisibilityToggles } from '@/features/maps/hooks';
import {
  createRouteLineCache,
  type RouteLineLayerInput,
} from '@/features/maps/lib/routeLineCollection';
import { buildSpiderGeoJSON } from '@/features/maps/lib/buildSpiderGeoJSON';
import { stackedOn } from '@/features/maps/lib/clusterZoom';
import { isHeatmapEnabled } from '@/features/maps/stores/HeatmapPreferenceStore';
import {
  clearHeatmapView,
  reportHeatmapView,
  useHeatmapGeneration,
} from '@/features/maps/lib/heatmapGeneration';
import {
  ActivityPopup,
  SectionPopup,
  SectionChooser,
  MapControlStack,
  ClusterCountOverlay,
  type ClusterCountOverlayRef,
  useMapHandlers,
  useRegionalMapCamera,
  useMapGeoJSON,
  type SelectedActivity,
  type SpiderState,
} from './regional';
import {
  buildRegionalLayers,
  buildRegionalSources,
  REGIONAL_INTERACTIVE_LAYERS,
  selectedRouteColor,
} from './regional/regionalMapLayerSpecs';
import {
  EMPTY_FEATURE_COLLECTION,
  boundsOfLngLat,
  lngLatFromShort,
  type LngLatBounds,
} from '../lib/coordinates';
import { surfaceIsLeaving, useInitialRegionalCamera } from '../hooks/useInitialRegionalCamera';

// Stable no-op function reference for disabled callbacks.
// Inline `() => {}` creates a new reference every render, which destabilises
// useCallback dependency chains and causes Android MapLibre camera snap-back.
const NOOP = () => {};

/**
 * Global map of every activity, clustered.
 *
 * Two things keep pan and zoom smooth with thousands of points:
 *
 * 1. Activity centres are computed once in useRegionalMapCamera, from the Rust-side
 *    RouteSignature where one exists, so no format detection runs per frame.
 *
 * 2. The marker collection never depend on selection. Selection is
 *    a paint expression over the selected id, so choosing an activity does not
 *    re-upload the point set.
 */
interface RegionalMapViewProps {
  /** Activities to display */
  activities: ActivityBoundsItem[];
  /** Routes the map can draw, which decides whether the routes button shows */
  routeCount?: number;
  /** The pre-built route lines, present while the routes layer is on and current */
  routeLines?: RouteLineLayerInput | undefined;
  sectionCount?: number;
  /** Route matching is on; off, zooming never turns the sections layer on. */
  sectionsEnabled?: boolean;
  sections?: MapSection[];
  /** Callback when attribution text changes */
  onAttributionChange?: (attribution: string) => void;
  /** Activity to open the popup for, once it is among `activities`. */
  selectActivityId?: string | undefined;
  /** Activity to open the popup for and fit the camera to, once it is among `activities`. */
  focusActivityId?: string | undefined;
  /** Section to open the popup for. */
  selectSectionId?: string | undefined;
}

export function RegionalMapView({
  activities,
  routeCount = 0,
  routeLines,
  sectionCount = 0,
  sectionsEnabled = true,
  sections = [],
  onAttributionChange,
  selectActivityId,
  focusActivityId,
  selectSectionId,
}: RegionalMapViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { getGlobalMapStyle, setGlobalMapStyle } = useMapPreferences();
  const insets = useSafeAreaInsets();
  const [chosenStyle, setMapStyleLocal] = useState<MapStyleType>(getGlobalMapStyle());
  const mapStyle = useDrawnMapStyle(chosenStyle);
  const [selected, setSelected] = useState<SelectedActivity | null>(null);
  const {
    showActivities,
    showHeatmap,
    showSections,
    showRoutes,
    is3DMode,
    setShowActivities,
    setShowSections,
    setShowRoutes,
    setIs3DMode,
    toggleHeatmap,
    toggle3D,
  } = useVisibilityToggles();
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  // The overlay carries six fields per section. The popup wants the whole
  // record, so it is read for the one section that was tapped.
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    selectSectionId ?? null
  );
  const { section: selectedSection } = useSectionDetail(selectedSectionId);
  const [sectionChoices, setSectionChoices] = useState<string[]>([]);
  const sectionById = useMemo(
    () => new Map(sections.map((section) => [section.id, section])),
    [sections]
  );
  const chosenSections = sectionChoices.flatMap((id) => {
    const section = sectionById.get(id);
    return section ? [section] : [];
  });
  const [spider, setSpider] = useState<SpiderState | null>(null);
  const surfaceRef = useRef<MapSurfaceRef>(null);

  // Only load route signatures when the map tab is focused
  // This prevents 80+ getGpsTrack FFI calls when switching to other tabs.
  // The same signal tears the surface down: a tab that is merely frozen keeps
  // its GL context and its tile textures, which is 122 MB nobody can see.
  const pathname = usePathname();
  const isMapFocused = pathname === '/map' || pathname.endsWith('/map');

  const [cameraOnBlur, setCameraOnBlur] = useState<{
    center: [number, number];
    zoom: number;
  } | null>(null);
  // Within a session `cameraOnBlur` carries the position across a tab switch.
  // Across a launch nothing did, so every cold start opened on the world view
  // over a camera that had been saved on every settle since.
  const { camera: initialCamera, restored: cameraRestored } =
    useInitialRegionalCamera(cameraOnBlur);

  // Camera, bounds, and pre-computed activity centers
  const { activityCenters, mapCenter, currentZoomRef, currentCenterRef, markUserInteracted } =
    useRegionalMapCamera({ activities, surfaceRef, cameraRestored });

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
    bounds?: LngLatBounds;
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
  // Where the surface was when the tab lost focus, so the rebuild on the way
  // back opens there. Null until the camera has actually settled once, which
  // leaves the first mount to the fit.
  const settledCameraRef = useRef<{
    center: [number, number];
    zoom: number;
  } | null>(null);
  const handleCameraSettled = useCallback(
    (center: [number, number], zoom: number, bounds?: LngLatBounds) => {
      settledCameraRef.current = { center, zoom };
      // The tile pass writes every zoom in full before the next, so without a
      // camera the ground under this view is drawn last on a fresh install.
      // `center` is [longitude, latitude], MapLibre's order.
      reportHeatmapView(center, zoom);
      if (mapStyleRef.current === 'satellite') {
        setCameraForAttribution({
          center,
          zoom,
          ...(bounds ? { bounds } : {}),
        });
      }
    },
    []
  );

  /** The 3D surface's camera, kept in the same place the 2D one's settles. */
  const handle3DCameraState = useCallback(
    (camera: { center: [number, number]; zoom: number }) => {
      handleCameraSettled(camera.center, camera.zoom);
    },
    [handleCameraSettled]
  );

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
        bounds: cameraForAttribution?.bounds ?? null,
      }),
    [mapStyle, cameraForAttribution, is3DMode]
  );

  // Notify parent when attribution changes
  useEffect(() => {
    onAttributionChange?.(attributionText);
  }, [attributionText, onAttributionChange]);

  // The decoded route lines stay the same object while the engine's layer generation is
  // unchanged, so a filter change hands MapLibre nothing new to diff.
  const routeLineCache = useRef(createRouteLineCache()).current;
  const routesGeoJSON = useMemo(
    () => routeLineCache.collection(showRoutes ? routeLines : undefined),
    [routeLineCache, showRoutes, routeLines]
  );

  // All GeoJSON data for map layers
  const { markersGeoJSON, sectionsGeoJSON, userLocationGeoJSON, routeGeoJSON, routeHasData } =
    useMapGeoJSON({
      allActivities: activities,
      activityCenters,
      sections,
      userLocation,
      selected,
    });

  // Event handlers
  const {
    handleMarkerTap,
    handleClosePopup,
    handleViewDetails,
    handleZoomToActivity,
    handleFocusActivity,
    handleSurfacePress,
    handleEmptyPress,
    handleRegionIsChanging,
    handleRegionDidChange: baseHandleRegionDidChange,
    handleGetLocation,
    toggleActivities,
    toggleSections: baseToggleSections,
    toggleRoutes,
    resetOrientation,
    handleFitAll,
  } = useMapHandlers({
    activities,
    selected,
    setSelected,
    setSelectedSectionId,
    setSectionChoices,
    showActivities,
    setShowActivities,
    showSections,
    setShowSections,
    showRoutes,
    setShowRoutes,
    setSelectedRoute: NOOP,
    userLocation,
    setUserLocation,
    setLocationLoading,
    currentZoomRef,
    currentCenterRef,
    onCameraSettled: handleCameraSettled,
    surfaceRef,
    map3DRef,
    bearingAnim,
    currentZoomLevel,
    is3DMode,
    markUserInteracted,
    setSpider,
  });

  // The markers are drawn into the canvas, so a link names the activity whose
  // popup opens. Each id opens once, so closing the popup leaves it closed.
  const openedActivityRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectActivityId || openedActivityRef.current === selectActivityId) return;
    const target = activities.find((a) => a.id === selectActivityId);
    if (!target) return;
    openedActivityRef.current = selectActivityId;
    handleMarkerTap(target);
  }, [selectActivityId, activities, handleMarkerTap]);

  // A search result brings the camera to the ride as well. Each choice fits
  // once, and unsetting the id lets the same ride be chosen and fitted again.
  const focusedActivityRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusActivityId) {
      focusedActivityRef.current = null;
      return;
    }
    if (focusedActivityRef.current === focusActivityId) return;
    const target = activities.find((a) => a.id === focusActivityId);
    if (!target) return;
    focusedActivityRef.current = focusActivityId;
    handleFocusActivity(target);
  }, [focusActivityId, activities, handleFocusActivity]);

  // Auto-show sections when zoomed in to neighborhood level, auto-hide when zoomed out.
  // Manual toggles (via the control button) take precedence and disable auto-behavior.
  const { handleRegionDidChange: autoToggleHandleRegionDidChange, toggleSections } =
    useSectionAutoToggle({
      showSections,
      setShowSections,
      baseHandleRegionDidChange,
      baseToggleSections,
      holdSections: !!selectSectionId,
      enabled: sectionsEnabled,
    });

  // A link to a section brings the camera to it once, when the record loads.
  const flownToSectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectSectionId || flownToSectionRef.current === selectSectionId) return;
    if (selectedSection?.id !== selectSectionId) return;
    const bounds = boundsOfLngLat(lngLatFromShort(selectedSection.polyline), 0.1);
    if (!bounds) return;
    flownToSectionRef.current = selectSectionId;
    surfaceRef.current?.fitBounds(bounds);
  }, [selectSectionId, selectedSection]);

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
  // Clearing them while rendering rather than in an effect means the hidden
  // layer never commits a frame still carrying its selection.
  if (!showActivities) {
    if (selected) setSelected(null);
    if (spider) setSpider(null);
  }
  if (!showSections && (selectedSection || sectionChoices.length > 0)) {
    setSelectedSectionId(null);
    setSectionChoices([]);
  }

  const toggleStyle = () => {
    setMapStyleLocal((current) => {
      const next = getNextStyle(current);
      setGlobalMapStyle(next);
      return next;
    });
  };

  // Handle 3D section click - receives section ID string, looks up section to select
  const handle3DSectionClick = useCallback((sectionId: string) => {
    setSectionChoices([]);
    setSelectedSectionId(sectionId);
  }, []);

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
  }, [selected]);

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

  // The 3D page has one point layer, so the fanned-out starts join the markers
  // there and a tap on one is a tap on a single point.
  const pointMarkers3D = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showActivities) return EMPTY_FEATURE_COLLECTION;
    if (spiderPointsGeoJSON.features.length === 0) return markersGeoJSON;
    return {
      type: 'FeatureCollection',
      features: [...markersGeoJSON.features, ...spiderPointsGeoJSON.features],
    };
  }, [showActivities, markersGeoJSON, spiderPointsGeoJSON]);

  // Starts stacked on one spot fan out, as on the 2D surface; anything else
  // opens the first point under the tap.
  const handle3DActivityClick = useCallback(
    (activityId: string, hits: GeoJSON.Feature[]) => {
      const stacked = stackedOn(hits);
      const first = stacked[0];
      if (first && stacked.length > 1) {
        setSpider({
          center: (first.geometry as GeoJSON.Point).coordinates as [number, number],
          leaves: stacked,
        });
        return;
      }
      setSpider(null);
      const activity = activities.find((a) => a.id === activityId);
      if (activity) handleMarkerTap(activity);
    },
    [activities, handleMarkerTap]
  );

  // 3D is available when we have any activities (terrain can be shown without a specific route)
  const can3D = activities.length > 0;
  // Show 3D view when enabled
  const show3D = is3DMode && can3D;

  // Entering 3D unmounts the 2D surface as surely as leaving the tab does, so
  // both snapshot where it was. Without the 3D half, coming back opened on the
  // camera saved at the last tab blur, and then saved that as the new one.
  useEffect(() => {
    if (surfaceIsLeaving(isMapFocused, show3D)) setCameraOnBlur(settledCameraRef.current);
  }, [isMapFocused, show3D]);

  // Leaving the tab leaves no map on any ground, so the tile pass stops
  // drawing this view first. 3D is not leaving: it shows the same ground and
  // reports its own camera.
  useEffect(() => {
    if (!isMapFocused) clearHeatmapView();
  }, [isMapFocused]);

  const heatmapEnabled = isHeatmapEnabled();
  // A finished pass is new ground under the same tile URLs, and MapLibre does
  // not ask twice. The count moves the source's URL, which is what makes it.
  const heatmapGeneration = useHeatmapGeneration();

  const sources = useMemo(
    () =>
      buildRegionalSources({
        markersGeoJSON,
        sectionsGeoJSON,
        routesGeoJSON,
        userLocationGeoJSON,
        routeGeoJSON,
        spiderPointsGeoJSON,
        spiderLinesGeoJSON,
        heatmapEnabled,
        heatmapGeneration,
      }),
    [
      markersGeoJSON,
      sectionsGeoJSON,
      routesGeoJSON,
      userLocationGeoJSON,
      routeGeoJSON,
      spiderPointsGeoJSON,
      spiderLinesGeoJSON,
      heatmapEnabled,
      heatmapGeneration,
    ]
  );

  // Sport colours wash out against the teal heatmap, so the selected route
  // switches colour while the heatmap is drawn underneath it.
  const routeColor = selected
    ? selectedRouteColor(getActivityTypeConfig(selected.activity.type).color, {
        enabled: heatmapEnabled,
        shown: showHeatmap,
      })
    : colors.textPrimary;

  const layers = useMemo(
    () =>
      buildRegionalLayers({
        isDark,
        mapStyle,
        showActivities,
        showSections,
        showRoutes,
        showHeatmap,
        heatmapEnabled,
        hasSpider: !!spider,
        hasUserLocation: !!userLocation,
        hasRouteData: routeHasData,
        selectedActivityId,
        selectedSectionId: selectedSection?.id ?? null,
        routeColor,
      }),
    [
      isDark,
      mapStyle,
      showActivities,
      showSections,
      showRoutes,
      showHeatmap,
      heatmapEnabled,
      spider,
      userLocation,
      routeHasData,
      selectedActivityId,
      selectedSection,
      routeColor,
    ]
  );

  return (
    <View style={styles.container}>
      {!isMapFocused ? null : show3D ? (
        <ComponentErrorBoundary
          componentName="3D Map"
          showRetry={false}
          onError={() => setIs3DMode(false)}
        >
          <Map3DWebView
            ref={map3DRef}
            coordinates={route3DCoords.length > 0 ? route3DCoords : undefined}
            mapStyle={mapStyle}
            routeColor={selected ? routeColor : undefined}
            initialCenter={currentCenterRef.current ?? mapCenter ?? undefined}
            initialZoom={currentZoomRef.current}
            // Pass an empty FeatureCollection (not undefined) when toggled off
            // so the WebView clears the previous data via setData; undefined
            // leaves the layer's last value cached and visible.
            routesGeoJSON={routesGeoJSON}
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
            pointMarkersGeoJSON={pointMarkers3D}
            spiderLinesGeoJSON={spiderLinesGeoJSON}
            showHeatmap={showHeatmap}
            // The 3D camera is the camera: without this the 2D surface came
            // back where 3D started rather than where the athlete left it.
            onCameraStateChange={handle3DCameraState}
            onSectionClick={handle3DSectionClick}
            onMapClick={handleEmptyPress}
            onActivityClick={handle3DActivityClick}
          />
        </ComponentErrorBoundary>
      ) : (
        <MapSurface
          ref={surfaceRef}
          mapStyle={mapStyle}
          // Rebuilt on every return to the tab, so it opens where the user
          // left it rather than back out at the world view.
          initialCamera={initialCamera}
          sources={sources}
          layers={layers}
          interactiveLayers={REGIONAL_INTERACTIVE_LAYERS}
          onMapReady={markUserInteracted}
          onPress={handleSurfacePress}
          onRegionIsChanging={handleRegionIsChanging}
          onRegionDidChange={handleRegionDidChange}
        />
      )}

      {/* Accessibility and test handle for cluster counts. Invisible to users -
          the map draws the glyphs itself, inside a canvas nothing else can see. */}
      {isMapFocused && !show3D && (
        <ClusterCountOverlay surfaceRef={surfaceRef} ref={clusterOverlayRef} />
      )}

      {/* Same idea for the sections layer: something outside the canvas that
          says whether sections are currently drawn. */}
      {!show3D && showSections && sectionsEnabled && (
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
        showRoutes={showRoutes}
        userLocationActive={!!userLocation}
        locationLoading={locationLoading}
        sectionCount={sectionCount}
        routeCount={routeCount}
        activityCount={activities.length}
        bearingAnim={bearingAnim}
        onToggle3D={toggle3D}
        onResetOrientation={resetOrientation}
        onGetLocation={handleGetLocation}
        onToggleActivities={toggleActivities}
        onToggleHeatmap={isHeatmapEnabled() ? toggleHeatmap : undefined}
        onToggleSections={toggleSections}
        onToggleRoutes={toggleRoutes}
        onFitAll={handleFitAll}
      />
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
          onClose={() => setSelectedSectionId(null)}
          onViewDetails={() => {
            setSelectedSectionId(null);
            router.push(`/section/${selectedSection.id}`);
          }}
        />
      )}
      {chosenSections.length > 1 && (
        <SectionChooser
          sections={chosenSections}
          onClose={() => setSectionChoices([])}
          onSelect={(id) => {
            setSectionChoices([]);
            setSelectedSectionId(id);
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
  button: {
    position: 'absolute',
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    backgroundColor: colorWithOpacity(ink.white, 0.95),
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
});
