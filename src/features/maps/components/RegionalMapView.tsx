import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useMapPreferences } from '@/features/settings/light';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { darkColors, ink, mapPalette, spacing } from '@/theme';
import { getActivityCategory, sportMarkColour, type SportFamily } from '../lib/activityCategories';
import { MapControlButton } from './MapControlButton';
import {
  TERRAIN_3D_CONFIG,
  type MapStyleType,
  getStyleIcon,
  statusBarStyleForMap,
} from './mapStyles';
import { MapSurface, type MapCameraState, type MapSurfaceRef } from './MapSurface';
import { useMapStyleToggle } from '@/features/maps/hooks/useDrawnMapStyle';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import { heatmapKeyColours } from '@/features/maps/lib/heatmapPaint';
import type { ActivityBoundsItem } from '@/types';
import { useSectionDetail } from '@/shared/native/useSectionDetail';
import { useTheme } from '@/shared/app';
import { useBackDismiss } from '@/shared/app/useBackDismiss';
import { useScreenPathname } from '@/shared/app/screenUnderSheet';
import type { MapSection } from '@/features/maps/hooks/useEngineMapActivities';
import {
  useSectionAutoToggle,
  useTerrainFallback,
  useVisibilityToggles,
} from '@/features/maps/hooks';
import {
  routeLinesSourceData,
  type RouteLineLayerInput,
} from '@/features/maps/lib/routeLineCollection';
import { buildSpiderGeoJSON } from '@/features/maps/lib/buildSpiderGeoJSON';
import { isHeatmapEnabled } from '@/features/maps/stores/HeatmapPreferenceStore';
import {
  clearHeatmapView,
  reportHeatmapView,
  useHeatmapGeneration,
} from '@/features/maps/lib/heatmapGeneration';
import {
  ActivityPopup,
  SectionPopup,
  RoutePopup,
  type MapRouteSummary,
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
import { mapTopControlsBottom, popupBottom } from '../lib/filterSheet';
import { useInitialRegionalCamera } from '../hooks/useInitialRegionalCamera';
import { useStoredTrackUrl } from '../hooks/useStoredTrackUrl';
import { useSectionChooser } from './regional/useSectionChooser';
import { navigateTo } from '@/shared/app/navigation';

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
const NO_SECTIONS: MapSection[] = [];

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
  /** The overlay's lines, the same object while the engine's stamp is unchanged */
  sectionsGeoJSON?: GeoJSON.FeatureCollection;
  /** Called when the credit changes. */
  onAttributionChange?: (attribution: string) => void;
  /** Activity to open the popup for, once it is among `activities`. */
  selectActivityId?: string | undefined;
  /** Activity to open the popup for and fit the camera to, once it is among `activities`. */
  focusActivityId?: string | undefined;
  /** Section to open the popup for. */
  selectSectionId?: string | undefined;
  /** Sport categories among the activities drawn, which the layers menu keys by colour. */
  keyCategories?: readonly SportFamily[] | undefined;
  /** Height the host draws over the foot of the map, as measured, which the popups clear. */
  bottomClearance?: number;
  /** What the map shows, for a screen reader. */
  mapLabel?: string | undefined;
}

export function RegionalMapView({
  activities,
  routeCount = 0,
  routeLines,
  sectionCount = 0,
  sectionsEnabled = true,
  sections = NO_SECTIONS,
  sectionsGeoJSON = EMPTY_FEATURE_COLLECTION,
  onAttributionChange,
  selectActivityId,
  focusActivityId,
  selectSectionId,
  keyCategories,
  bottomClearance = 0,
  mapLabel,
}: RegionalMapViewProps) {
  const { t } = useTranslation();
  const { getGlobalMapStyle, setGlobalMapStyle } = useMapPreferences();
  const insets = useSafeAreaInsets();
  const [chosenStyle, setMapStyleLocal] = useState<MapStyleType>(getGlobalMapStyle());
  const chooseStyle = useCallback(
    (next: MapStyleType) => {
      setMapStyleLocal(next);
      setGlobalMapStyle(next);
    },
    [setGlobalMapStyle]
  );
  const { drawn: mapStyle, cycle: toggleStyle } = useMapStyleToggle(chosenStyle, chooseStyle);
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
  // 3D is available when we have any activities (terrain can be shown without a specific route)
  const can3D = activities.length > 0;
  const show3D = is3DMode && can3D;
  const popupFloor = popupBottom(bottomClearance, insets.bottom);
  // The map fills its tab, so the notice joins the screen's bottom pills above the sheet.
  const { onTerrainUnavailable, terrainNotice } = useTerrainFallback(
    () => setIs3DMode(false),
    'pillStack'
  );
  // The overlay carries six fields per section. The popup wants the whole
  // record, so it is read for the one section that was tapped.
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const { section: selectedSection } = useSectionDetail(selectedSectionId);
  const chooseSection = useSectionChooser(sections, setSelectedSectionId);
  const [spider, setSpider] = useState<SpiderState | null>(null);
  // The popup reads the route from the map read's own lines, so a rename or a
  // new member shows on the next read.
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const selectedRoute = useMemo<MapRouteSummary | null>(() => {
    if (!selectedRouteId) return null;
    return routeLines?.routes.find((route) => route.routeId === selectedRouteId) ?? null;
  }, [routeLines, selectedRouteId]);
  const surfaceRef = useRef<MapSurfaceRef>(null);

  // Only load route signatures when the map tab is focused
  // This prevents 80+ getGpsTrack FFI calls when switching to other tabs.
  // The same signal tears the surface down: a tab that is merely frozen keeps
  // its GL context and its tile textures, which is 122 MB nobody can see. A sheet
  // presented over the tab leaves the map on display, so it is not leaving.
  const pathname = useScreenPathname();
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

  // Every control over the map follows the app theme; the layers read the base themselves.
  const { isDark } = useTheme();
  // The heat ramp as the layer draws it, over the ground of the menu it is keyed in.
  const heatKeyColours = useMemo(
    () => heatmapKeyColours(mapStyle, isDark ? darkColors.surfaceRaised : ink.white),
    [mapStyle, isDark]
  );

  // Camera position for satellite attribution (updated by onCameraSettled callback, not on every gesture)
  const [cameraForAttribution, setCameraForAttribution] = useState<{
    center: [number, number];
    zoom: number;
    bounds?: LngLatBounds;
  } | null>(null);

  // Initialise satellite attribution from mapCenter when activities load
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

  // Dynamic attribution based on visible satellite sources at current location.
  // Shared with ActivityMapView via `computeAttribution` so both maps stay in sync
  // when tile sources or satellite attribution rules change.
  const attributionText = useMemo(
    () =>
      computeAttribution({
        style: mapStyle,
        is3D: show3D,
        center: cameraForAttribution?.center ?? null,
        zoom: cameraForAttribution?.zoom ?? 0,
        bounds: cameraForAttribution?.bounds ?? null,
      }),
    [mapStyle, cameraForAttribution, show3D]
  );

  useEffect(() => {
    onAttributionChange?.(attributionText);
  }, [attributionText, onAttributionChange]);

  // The route lines are the engine's URL for the layer's generation, so a filter change
  // that re-reads the map hands MapLibre the same string and nothing to fetch.
  const routeLinesGeneration = showRoutes ? routeLines?.generation : undefined;
  const routesGeoJSON = useMemo(
    () =>
      routeLinesSourceData(
        routeLinesGeneration === undefined ? undefined : { generation: routeLinesGeneration }
      ),
    [routeLinesGeneration]
  );

  // Event handlers
  const {
    handleMarkerTap,
    handleClosePopup,
    handleViewDetails,
    handleZoomToActivity,
    handleFocusActivity,
    handleSurfacePress,
    handleRegionIsChanging,
    handleRegionDidChange: baseHandleRegionDidChange,
    handleGetLocation,
    userLocation,
    locationLoading,
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
    chooseSection,
    showActivities,
    setShowActivities,
    showSections,
    setShowSections,
    showRoutes,
    setShowRoutes,
    setSelectedRouteId,
    currentZoomRef,
    currentCenterRef,
    onCameraSettled: handleCameraSettled,
    surfaceRef,
    bearingAnim,
    currentZoomLevel,
    markUserInteracted,
    setSpider,
  });

  // The selected activity's line, fetched by the page from the engine. Every
  // activity this map lists is a catalogue row, so the engine holds its track.
  const selectedTrackUrl = useStoredTrackUrl(selected?.activity.id, !!selected);

  // All GeoJSON data for map layers
  const { markersGeoJSON, userLocationGeoJSON, routeGeoJSON, routeHasData } = useMapGeoJSON({
    allActivities: activities,
    activityCenters,
    userLocation,
    selected,
    selectedTrackUrl,
    isDark,
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
  // Manual toggles (via the control button) take precedence and disable auto-behaviour.
  const { handleRegionDidChange: autoToggleHandleRegionDidChange, toggleSections } =
    useSectionAutoToggle({
      showSections,
      setShowSections,
      baseHandleRegionDidChange,
      baseToggleSections,
      holdSections: !!selectSectionId,
      enabled: sectionsEnabled,
    });

  // A link to a section opens its popup, with the overlay on so the popup is not
  // cleared as hidden. Each id opens once, so closing the popup leaves it closed.
  const openedSectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectSectionId || openedSectionRef.current === selectSectionId) return;
    openedSectionRef.current = selectSectionId;
    setShowSections(true);
    setSelectedSectionId(selectSectionId);
  }, [selectSectionId, setShowSections]);

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
  if (!showSections && selectedSection) {
    setSelectedSectionId(null);
  }
  // A route the read no longer draws, hidden or regrouped away, has no popup.
  if (selectedRouteId && (!showRoutes || (routeLines && !selectedRoute))) {
    setSelectedRouteId(null);
  }

  // Back closes whichever popup or list opened last, before it switches tab.
  useBackDismiss(!!selected, handleClosePopup);
  useBackDismiss(!!selectedSection, () => setSelectedSectionId(null));
  useBackDismiss(!!selectedRoute, () => setSelectedRouteId(null));

  // Selected activity ID for MapLibre expressions (cheap to pass, doesn't trigger GeoJSON rebuild)
  const selectedActivityId = selected?.activity.id ?? null;

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

  // Leaving the tab tears the surface down, so where it was is kept for the
  // mount that brings it back. 3D tilts the same surface and leaves it mounted.
  useEffect(() => {
    if (!isMapFocused) setCameraOnBlur(settledCameraRef.current);
  }, [isMapFocused]);

  // Leaving the tab leaves no map on any ground, so the tile pass stops
  // drawing this view first. 3D is not leaving: it is the same map, tilted.
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
  const palette = mapPalette(mapStyle);
  const routeColor = selected
    ? selectedRouteColor(
        sportMarkColour(getActivityCategory(selected.activity.type), isDark),
        { enabled: heatmapEnabled, shown: showHeatmap },
        palette
      )
    : palette.theme.textPrimary;

  const layers = useMemo(
    () =>
      buildRegionalLayers({
        palette,
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
        selectedRouteId: selectedRoute?.routeId ?? null,
        routeColor,
        terrain: show3D,
      }),
    [
      palette,
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
      selectedRoute,
      routeColor,
      show3D,
    ]
  );

  // 3D is this map tilted over the elevation model: the same sources, layers
  // and taps, and pitch and rotate gestures while it is on. A page with no
  // elevation tiles reports it and the map lies flat again.
  const terrain = useMemo(
    () =>
      show3D
        ? {
            exaggeration: TERRAIN_3D_CONFIG.defaultExaggeration,
            pitch: TERRAIN_3D_CONFIG.defaultPitch,
          }
        : null,
    [show3D]
  );

  return (
    <View style={styles.container}>
      {/* The map is drawn under the status bar, so its glyphs follow the map style rather than
          the app theme. The entry exists only while the tab is focused, so it leaves with it. */}
      {isMapFocused ? <StatusBar style={statusBarStyleForMap(mapStyle)} animated /> : null}
      {isMapFocused ? (
        <MapSurface
          ref={surfaceRef}
          mapStyle={mapStyle}
          // Rebuilt on every return to the tab, so it opens where the user
          // left it rather than back out at the world view.
          initialCamera={initialCamera}
          sources={sources}
          layers={layers}
          interactiveLayers={REGIONAL_INTERACTIVE_LAYERS}
          terrain={terrain}
          onMapReady={markUserInteracted}
          onPress={handleSurfacePress}
          onRegionIsChanging={handleRegionIsChanging}
          onRegionDidChange={handleRegionDidChange}
          onTerrainUnavailable={onTerrainUnavailable}
          accessibilityLabel={mapLabel}
        />
      ) : null}

      {/* Accessibility and test handle for cluster counts. Invisible to users -
          the map draws the glyphs itself, inside a canvas nothing else can see. */}
      {isMapFocused ? (
        <ClusterCountOverlay surfaceRef={surfaceRef} ref={clusterOverlayRef} />
      ) : null}

      {/* Same idea for the sections layer: something outside the canvas that
          says whether sections are currently drawn. */}
      {showSections && sectionsEnabled ? (
        <View
          testID="regional-map-sections-overlay"
          accessibilityLabel={t('maps.showSections')}
          style={styles.layerMarker}
          pointerEvents="none"
        />
      ) : null}

      {terrainNotice}

      {/* Style toggle */}
      <MapControlButton
        style={[styles.button, styles.styleButton, { top: insets.top + spacing.smPlus }]}
        onPress={toggleStyle}
        accessibilityLabel={t('maps.toggleStyle')}
      >
        <MapControlButton.Glyph name={getStyleIcon(mapStyle)} />
      </MapControlButton>
      {/* The control column, one rung below the style toggle. */}
      <MapControlStack
        top={mapTopControlsBottom(insets.top)}
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
        keyCategories={keyCategories}
        heatKeyColours={heatKeyColours}
        linePalette={palette}
      />
      {/* The popups sit above whatever the host draws over the foot of the map. */}
      {selected ? (
        <ActivityPopup
          selected={selected}
          bottom={popupFloor}
          onZoom={handleZoomToActivity}
          onClose={handleClosePopup}
          onViewDetails={handleViewDetails}
        />
      ) : null}
      {selectedSection ? (
        <SectionPopup
          section={selectedSection}
          bottom={popupFloor}
          onClose={() => setSelectedSectionId(null)}
          onViewDetails={() => {
            setSelectedSectionId(null);
            navigateTo(`/section/${selectedSection.id}`);
          }}
        />
      ) : null}
      {selectedRoute ? (
        <RoutePopup
          route={selectedRoute}
          bottom={popupFloor}
          onClose={() => setSelectedRouteId(null)}
          onViewDetails={() => {
            setSelectedRouteId(null);
            navigateTo(`/route/${selectedRoute.routeId}`);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.surfacePage,
  },
  button: {
    position: 'absolute',
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
