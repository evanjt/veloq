/**
 * Hero map view for section detail page.
 * Displays the section polyline (medoid trace) prominently.
 *
 * Performance optimisation: Pre-loads all activity traces as a FeatureCollection
 * and uses filter expressions to show/hide them. This avoids expensive shape
 * geometry updates when the user scrubs through different activities.
 *
 * When interactive={true} (section detail hero), renders a full control stack
 * matching ActivityMapView: style toggle, 3D terrain, compass, GPS, fullscreen.
 *
 * Wrapped in React.memo to prevent re-renders during scrubbing when props are stable.
 */

import React, { useMemo, useRef, useState, useCallback, useEffect, memo } from 'react';
import { View, StatusBar, Animated, useWindowDimensions } from 'react-native';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { useTranslation } from 'react-i18next';
import { getActivityColor } from '@/shared/activity/activityUtils';
import {
  cameraMove,
  colorWithOpacity,
  colors,
  duration,
  iconSize,
  mapPalette,
  opacity,
  spacing,
  type MapPalette,
} from '@/theme';
import { useMapPreferences } from '@/features/settings';
import { useTheme } from '@/shared/app';
import { useMapHeldFocus } from '@/shared/app/MapSheetHost';
import {
  useSettleCamera,
  BaseMapView,
  type BaseMap3DLayer,
  boundsOfLngLat,
  featureCollection,
  getStyleIcon,
  statusBarStyleForMap,
  lngLatFromShort,
  lngLatFromShortPoint,
  Map3DWebView,
  type Map3DWebViewRef,
  type LineDirection,
  ENDPOINT_AND_DIRECTION_IMAGES,
  type MapCameraState,
  type MapSurfaceRef,
  AttributionOverlay,
  SlottedMapSurface,
  useInMapSurfaceSlot,
  pointFeature,
  TRIM_UPDATE_THROTTLE_MS,
  useMapFullscreen,
  useMapStyleToggle,
  useSurfaceAttribution,
  useTerrainFallback,
  buildSectionTrimCollection,
  EMPTY_FEATURE_COLLECTION,
  cameraAfter3D,
  type Camera3DState,
  buildUserLocationCollection,
  useLocateUser,
  mapControlColumnLayout,
  MapControlButton,
  visibleMapInset,
} from '@/features/maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ComponentErrorBoundary } from '@/shared/ui';
import { PressTarget } from '@/shared/ui/PressTarget';
import { useThrottledValue } from '@/shared/ui/useThrottledValue';
import { Icon } from '@/shared/ui/Icon';
import type { FrequentSection, RoutePoint, ActivityType } from '@/types';
import { toActivityType } from '@/features/routes/types';
import { onlySport } from '@/shared/activity/sportSet';
import { useSectionMapLayers } from './useSectionMapLayers';
import { buildSection3DOverlays } from './sectionMap3DOverlays';
import {
  cutLineByProgress,
  deltaLineBands,
  lineBandExpression,
  LOCATE_GLYPH,
  noDataRanges,
} from '@/features/maps';
import type { SectionDeltaLine } from '../lib/deltaLayout';
import { DetailMapLegend, hasLegendLayers } from './DetailMapLegend';
import {
  buildSectionLayers,
  buildSectionSources,
  drawnSectionDirection,
  sectionMapSpecs,
} from './sectionMapLayerSpecs';
import { useStableBy } from '@/shared/app/useStableBy';
import {
  SECTION_MAP_BOUNDS_PADDING,
  SECTION_MAP_FIT_PADDING,
  SECTION_MAP_MAX_ZOOM,
  sectionCameraSpec,
} from '@/features/routes/lib/sectionMapCamera';
import { styles } from './sectionMapView.styles';
import { motionTiming } from '@/shared/ui/reduceMotion';

interface SectionMapViewProps {
  section: FrequentSection;
  /**
   * The sport the screen is reading the section in. Without one the map takes
   * the section's only sport, and for ground several sports have taken, the
   * athlete's default style and the neutral line colour.
   */
  sportType?: string | undefined;
  height?: number | undefined;
  /** Enable map interaction (zoom, pan). Default false for preview, true for detail. */
  interactive?: boolean | undefined;
  /** Enable tap to fullscreen */
  enableFullscreen?: boolean | undefined;
  /** Optional full activity track to show as a shadow behind the section */
  shadowTrack?: [number, number][] | undefined;
  /** Activity ID to highlight (show prominently) */
  highlightedActivityId?: string | null | undefined;
  /** Specific lap points to highlight (takes precedence over highlightedActivityId) */
  highlightedLapPoints?: RoutePoint[] | undefined;
  /** When the highlighted attempt was ridden, which the map key names it by. */
  highlightedActivityDate?: Date | undefined;
  /** The activity the page was opened from, the only one the key calls "This activity". */
  pageActivityId?: string | undefined;
  /**
   * Pre-loaded activity traces for fast scrubbing.
   * When provided, all traces are rendered in a single FeatureCollection
   * and a filter expression is used to show only the highlighted one.
   * This avoids expensive shape geometry updates during scrubbing.
   */
  allActivityTraces?: Record<string, RoutePoint[]> | undefined;
  /** Trim range for bounds editing - when set, shows full polyline faded + trimmed portion highlighted */
  trimRange?: { start: number; end: number } | null | undefined;
  /** Extension track for expanding section bounds - shown as faded line beyond the section */
  extensionTrack?: RoutePoint[] | null | undefined;
  /**
   * Bottom edge of whatever covers the map's top, inset and header included.
   * The map draws edge to edge, so the legend and the controls start below it.
   */
  headerBottom?: number | undefined;
  /**
   * The height over the map's foot that something else covers: its sheet at the stop it rests
   * at, or a map tool's bar. The section is fitted above it and the controls stop short of it,
   * and a change refits the section.
   */
  coveredBottom?: number | undefined;
  /** Width over the map's sides that a regular-width side panel covers. The section is fitted beside it. */
  coveredLeft?: number | undefined;
  coveredRight?: number | undefined;
  /** Corner radius of the rounded sheet top under `coveredBottom`, which the credit keeps clear of. */
  coveredBottomRadius?: number | undefined;
  /** The attempt the chart's delta plot shows. While set, the section line is coloured by it. */
  deltaLine?: SectionDeltaLine | null | undefined;
  /**
   * The direction the performance panel is on, drawn as chevrons along the
   * section line. Null where the section is ridden one way only.
   */
  shownDirection?: LineDirection | null | undefined;
  /**
   * What a tap on a preview map does in place of fullscreen, such as opening
   * the section's screen. Ignored when the map is interactive.
   */
  onPress?: (() => void) | undefined;
  /** Says what `onPress` does, for a screen reader. */
  pressLabel?: string | undefined;
}

// Stable identities, so the closed-modal memos below return the same empty set
// every render rather than a new one the surface would re-stringify.
const EMPTY_SOURCES: ReturnType<typeof buildSectionSources> = {};
const EMPTY_LAYERS: ReturnType<typeof buildSectionLayers> = [];

export const SectionMapView = memo(function SectionMapView({
  section,
  sportType,
  height = 200,
  interactive = false,
  enableFullscreen = false,
  shadowTrack,
  highlightedActivityId = null,
  highlightedLapPoints,
  highlightedActivityDate,
  pageActivityId,
  allActivityTraces,
  trimRange = null,
  extensionTrack = null,
  headerBottom = 0,
  coveredBottom = 0,
  coveredLeft = 0,
  coveredRight = 0,
  coveredBottomRadius = 0,
  deltaLine = null,
  shownDirection = null,
  onPress,
  pressLabel,
}: SectionMapViewProps) {
  const { t } = useTranslation();
  const { isFullscreen, openFullscreen, closeFullscreen } = useMapFullscreen({
    enableFullscreen,
  });
  const { getStyleForActivity, preferences } = useMapPreferences();

  // The first row of the map that is not under the status bar or the header.
  // Everything floated over the map's top corners starts here.
  const fullscreenInsets = useSafeAreaInsets();
  const overlayTop = headerBottom + spacing.sm;

  // The engine sends the sport as a string, so it is read against the one
  // activity vocabulary the app keeps. A sport nothing recognises is `Other`,
  // which has a style and a colour of its own; calling it a road ride hands
  // back the wrong one of the athlete's own choices.
  const sport = sportType ?? onlySport(section.sportTypes);
  const validSportType: ActivityType | undefined = sport ? toActivityType(sport) : undefined;

  const preferredStyle = validSportType
    ? getStyleForActivity(validSportType)
    : preferences.defaultStyle;
  const [currentMapStyle, setCurrentMapStyle] = useState(preferredStyle);
  const { drawn: drawnMapStyle, cycle: toggleMapStyle } = useMapStyleToggle(
    currentMapStyle,
    setCurrentMapStyle
  );
  const activityColor = getActivityColor(validSportType ?? 'Other');
  const palette = mapPalette(drawnMapStyle);
  const surfaceRef = useRef<MapSurfaceRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const handleMapReady = useCallback(() => setMapReady(true), []);
  const inSlot = useInMapSurfaceSlot();
  // The surface is unmounted while the 3D layer covers it, so the viewport it
  // settled on is what a remount opens with, not the section fit again.
  const settledCameraRef = useRef<{
    center: [number, number];
    zoom: number;
  } | null>(null);
  const [cameraOnHide, setCameraOnHide] = useState<{
    center: [number, number];
    zoom: number;
  } | null>(null);
  // Interactive-mode state
  const [is3DMode, setIs3DMode] = useState(false);
  const { attributionRef, initialAttribution, trackAttribution } = useSurfaceAttribution(
    drawnMapStyle,
    { is3D: is3DMode }
  );
  const handleRegionDidChange = useCallback(
    (state: MapCameraState) => {
      settledCameraRef.current = { center: state.center, zoom: state.zoom };
      trackAttribution(state);
    },
    [trackAttribution]
  );
  const camera3DRef = useRef<Camera3DState | null>(null);
  const handleCamera3DChange = useCallback((camera: Camera3DState) => {
    camera3DRef.current = camera;
  }, []);
  // A camera from an earlier 3D visit is not where this one was left.
  useEffect(() => {
    if (is3DMode) camera3DRef.current = null;
  }, [is3DMode]);
  const [is3DReady, setIs3DReady] = useState(false);
  const { userLocation, locationLoading, locate } = useLocateUser();
  const map3DRef = useRef<Map3DWebViewRef>(null);
  // A screen covered by another keeps its WebViews but releases their maps,
  // which hold the GL context and every tile texture in it. A map in a host
  // stays held under its own sheet.
  const screenFocused = useMapHeldFocus();
  const map3DOpacity = useRef(new Animated.Value(0)).current;
  const bearingAnim = useRef(new Animated.Value(0)).current;

  // Memoised so the empty fallback is one array rather than a fresh one each
  // render, which recomputed every projection below it.
  const polyline = section.polyline;
  const displayPoints = useMemo(() => polyline || [], [polyline]);
  const sectionCoords = useMemo(() => lngLatFromShort(displayPoints), [displayPoints]);

  // Expand mode fits the whole context window, not just the section portion, so
  // the user can see what there is to expand into.
  const extensionCoords = useMemo(
    () => (extensionTrack ? lngLatFromShort(extensionTrack) : []),
    [extensionTrack]
  );
  const hasRoute = sectionCoords.length > 0;
  // Fullscreen button is part of control stack when interactive
  const isTrimming = !!trimRange;
  // Style, compass and location always show; 3D needs a line, full screen is off while trimming.
  const controlCount = 3 + (hasRoute ? 1 : 0) + (enableFullscreen && !isTrimming ? 1 : 0);
  const {
    maxHeight: controlsMaxHeight,
    width: controlsWidth,
    footprint: controlsFootprint,
  } = mapControlColumnLayout(controlCount, height - coveredBottom, overlayTop);
  // The section is fitted to what the header, the sheet or tool below and, when it is drawn, the
  // control column leave visible.
  const { width: mapWidth } = useWindowDimensions();
  const fitPadding = useMemo(
    () =>
      visibleMapInset({
        width: mapWidth,
        height,
        coveredTop: overlayTop,
        coveredLeft,
        coveredRight: coveredRight + (interactive ? controlsFootprint : 0),
        coveredBottom,
        margin: SECTION_MAP_FIT_PADDING,
      }),
    [
      mapWidth,
      height,
      overlayTop,
      interactive,
      controlsFootprint,
      coveredBottom,
      coveredLeft,
      coveredRight,
    ]
  );
  const frameSize = useMemo(() => ({ width: mapWidth, height }), [mapWidth, height]);
  // Controls and legends over the map follow the app theme, not the base drawn under them.
  const { isDark } = useTheme();

  // The 2D surface comes down once the 3D layer covers it, so where it was is
  // captured on the way out and handed back to the remount. A slot's surface is
  // shared with the subjects beneath this one, so it stays under the 3D layer.
  const show2DSurface = inSlot || !(is3DMode && is3DReady);
  const is3DLoading = is3DMode && !is3DReady;
  useEffect(() => {
    if (!show2DSurface) {
      setCameraOnHide(settledCameraRef.current);
      setMapReady(false);
    }
  }, [show2DSurface]);

  // Stop in-flight animations on unmount
  useEffect(() => {
    return () => {
      map3DOpacity.stopAnimation();
      bearingAnim.stopAnimation();
    };
  }, [map3DOpacity, bearingAnim]);

  // Frame each section once and again on entering or leaving expand mode. A change in what covers the
  // map, as the sheet settles at another stop or a tool's bar replaces it, moves the camera through
  // `useSettleCamera`.
  // Keying the refit on the geometry took the camera back on every `sections`
  // event, because the detail bundle hands down a fresh `polyline` array of the
  // same points, so panning the map was undone by the next sync. Extending
  // further inside expand mode is the athlete moving the handle rather than a
  // mode change, so it leaves the viewport alone too.
  const { markMoved, markFramed } = useSettleCamera(fitPadding, surfaceRef, mapReady);
  const handleRegionChanging = useCallback(() => markMoved(), [markMoved]);
  const isExpanding = extensionCoords.length > 0;
  const frameKey = `${section.id}|${isExpanding}`;
  // A slot moves its shared camera to each subject it takes, or back to where one was left, so
  // there only a later key refits the section.
  const framedSection = useRef<string | null>(inSlot ? frameKey : null);
  useEffect(() => {
    if (framedSection.current === frameKey) return;
    const nextBounds = boundsOfLngLat(
      isExpanding ? extensionCoords : sectionCoords,
      SECTION_MAP_BOUNDS_PADDING
    );
    if (!nextBounds) return;
    framedSection.current = frameKey;
    surfaceRef.current?.fitBounds(nextBounds, fitPadding, cameraMove.move);
    markFramed();
  }, [frameKey, extensionCoords, sectionCoords, isExpanding, fitPadding, markFramed]);

  // Reset 3D ready state when toggling off
  useEffect(() => {
    if (!is3DMode) {
      setIs3DReady(false);
      map3DOpacity.setValue(0);
    }
  }, [is3DMode, map3DOpacity]);

  // Handle 3D map ready - fade in the 3D view
  // A 3D page that cannot render drops back to the 2D map, otherwise the
  // spinner has no terminal path. Same landing as the error boundary below.
  const handleMap3DFailed = useCallback(() => {
    setIs3DReady(false);
    setIs3DMode(false);
  }, []);
  const { onTerrainUnavailable, terrainNotice } = useTerrainFallback(handleMap3DFailed);

  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    motionTiming(map3DOpacity, {
      toValue: 1,
      duration: duration.slow,
      useNativeDriver: true,
    }).start();
  }, [map3DOpacity]);

  // Handle bearing changes from either renderer (for compass sync)
  const handleBearingChange = useCallback(
    (bearing: number) => {
      bearingAnim.setValue(-bearing);
    },
    [bearingAnim]
  );

  // Toggle 3D mode
  const toggle3D = useCallback(() => {
    setIs3DMode((current) => !current);
  }, []);

  // Reset orientation (bearing and pitch in 3D)
  const resetOrientation = useCallback(() => {
    if (is3DMode && is3DReady) {
      map3DRef.current?.resetOrientation();
    } else {
      surfaceRef.current?.resetOrientation();
    }
  }, [is3DMode, is3DReady]);

  const handleGetLocation = useCallback(
    () => locate(is3DMode && is3DReady ? map3DRef.current : surfaceRef.current),
    [locate, is3DMode, is3DReady]
  );

  const sectionLayerData = useSectionMapLayers({
    section,
    displayPoints,
    shadowTrack,
    highlightedActivityId,
    highlightedLapPoints,
    allActivityTraces,
    trimRange,
    extensionTrack,
  });

  const overlays3D = useMemo(
    () => buildSection3DOverlays(sectionLayerData, highlightedActivityId),
    [sectionLayerData, highlightedActivityId]
  );

  const deltaBands = useMemo(
    () =>
      deltaLine
        ? deltaLineBands(
            deltaLine.percents,
            deltaLine.splitStepM,
            deltaLine.sectionLengthM,
            deltaLine.direction
          )
        : null,
    [deltaLine]
  );
  const deltaGapsGeoJSON = useMemo(
    () => cutLineByProgress(sectionCoords, noDataRanges(deltaBands)),
    [sectionCoords, deltaBands]
  );
  // The fullscreen map draws the section as its route line, in the same ramp.
  const fullscreenGradient = useCallback(
    (fullscreenPalette: MapPalette) =>
      deltaBands ? lineBandExpression(deltaBands, fullscreenPalette) : null,
    [deltaBands]
  );

  const legendLayers = {
    showActivity:
      sectionLayerData.highlightedTraceGeoJSON !== EMPTY_FEATURE_COLLECTION ||
      sectionLayerData.highlightedTraceFilter !== undefined,
    showEarlierVersion: sectionLayerData.shadowGeoJSON !== EMPTY_FEATURE_COLLECTION,
    showDelta: deltaBands !== null,
    showDeltaGaps: deltaGapsGeoJSON.features.length > 0,
    // Both maps draw the chevrons, so both keys name them.
    direction: drawnSectionDirection(shownDirection, trimRange),
  };
  const pickedAttempt = {
    activityId: highlightedActivityId,
    date: highlightedActivityDate,
    pageActivityId,
  };
  // Adjust opacity when something is highlighted or trimming
  const sectionContext = !!(highlightedActivityId || highlightedLapPoints || trimRange);

  // Use trimmed positions for markers when trimming
  // In expand mode, indices are relative to the extension track, not the section polyline
  const markerSource = trimRange && extensionTrack?.length ? extensionTrack : displayPoints;
  const startPoint = trimRange ? markerSource[trimRange.start] : displayPoints[0];
  const endPoint = trimRange
    ? markerSource[trimRange.end]
    : displayPoints[displayPoints.length - 1];

  const endpoints = useMemo(() => {
    const start = lngLatFromShortPoint(startPoint);
    const end = lngLatFromShortPoint(endPoint);
    return featureCollection([
      start ? pointFeature(start, { position: 'start' }) : null,
      end ? pointFeature(end, { position: 'end' }) : null,
    ]);
  }, [startPoint, endPoint]);

  // Trim drags arrive faster than the map needs. The slider stays smooth on the
  // UI thread while the geometry that reaches the surface is held to a budget.
  const trimmedGeoJSON = useThrottledValue(
    sectionLayerData.trimmedGeoJSON,
    TRIM_UPDATE_THROTTLE_MS
  );

  const sectionTrimGeoJSON = useMemo(
    () =>
      buildSectionTrimCollection({
        trimRange,
        trimmed: trimmedGeoJSON,
        extension: sectionLayerData.extensionGeoJSON,
        endpoints,
      }),
    [trimRange, trimmedGeoJSON, sectionLayerData.extensionGeoJSON, endpoints]
  );

  const specInput = useMemo(
    () => ({
      ...sectionLayerData,
      deltaBands,
      deltaGapsGeoJSON,
      shownDirection,
      trimmedGeoJSON,
      endpoints,
      sectionContext,
      trimRange,
      hasExtension: extensionCoords.length > 0,
    }),
    [
      sectionLayerData,
      deltaBands,
      deltaGapsGeoJSON,
      shownDirection,
      trimmedGeoJSON,
      endpoints,
      sectionContext,
      trimRange,
      extensionCoords.length,
    ]
  );

  const userLocationGeoJSON = useMemo(
    () => buildUserLocationCollection(userLocation),
    [userLocation]
  );

  const specs = useMemo(
    () =>
      sectionMapSpecs({
        ...specInput,
        palette,
        userLocationGeoJSON,
        hasUserLocation: userLocation !== null,
        showExtensionAndSection: true,
        trimCasingWidth: 5,
        trimLineWidth: 4,
        traceCasingWidth: 5,
        traceLineWidth: 4,
        extentCoords: extensionCoords.length > 0 ? extensionCoords : sectionCoords,
      }),
    [specInput, palette, userLocationGeoJSON, userLocation, extensionCoords, sectionCoords]
  );
  // The extent moves only with the line framed, not with what is picked on it.
  const bounds = useStableBy(specs.bounds, JSON.stringify(specs.bounds));

  // Fullscreen already draws the section through BaseMapView's own route line,
  // so it only adds the overlays and draws the trim a touch heavier.
  const fullscreenSpecArgs = useMemo(
    () => ({
      ...specInput,
      showExtensionAndSection: false,
      trimCasingWidth: 6,
      trimLineWidth: 5,
      traceCasingWidth: 6,
      traceLineWidth: 5,
    }),
    [specInput]
  );

  // Only the modal reads these, and a chart scrub sends a new `specInput` per
  // index, so building them while it is shut is a whole spec set thrown away
  // every frame of the gesture.
  const fullscreenSources = useMemo(
    () => (isFullscreen ? buildSectionSources(fullscreenSpecArgs) : EMPTY_SOURCES),
    [isFullscreen, fullscreenSpecArgs]
  );
  const fullscreenLayers = useCallback(
    (fullscreenPalette: MapPalette) =>
      isFullscreen
        ? buildSectionLayers({ ...fullscreenSpecArgs, palette: fullscreenPalette })
        : EMPTY_LAYERS,
    [isFullscreen, fullscreenSpecArgs]
  );

  // Fullscreen in 3D draws the trim and the highlighted activity and lap the
  // inline 3D map does, from the same collections.
  const fullscreenLayer3D = useMemo<BaseMap3DLayer>(
    () => ({
      sectionTrimGeoJSON,
      highlightedTraceGeoJSON: overlays3D.highlightGeoJSON,
    }),
    [sectionTrimGeoJSON, overlays3D.highlightGeoJSON]
  );

  if (!bounds || displayPoints.length === 0) {
    return (
      <View
        style={[
          styles.placeholder,
          { height, backgroundColor: colorWithOpacity(activityColor, opacity.tint2) },
        ]}
      >
        <Icon name="map-marker-off" size={iconSize.xl} color={activityColor} />
      </View>
    );
  }

  const mapContent = (
    <SlottedMapSurface
      ref={surfaceRef}
      mapStyle={drawnMapStyle}
      initialCamera={
        cameraAfter3D(camera3DRef.current, cameraOnHide) ?? {
          ...sectionCameraSpec(bounds, fitPadding),
          maxZoom: SECTION_MAP_MAX_ZOOM,
        }
      }
      sources={specs.sources}
      layers={specs.layers}
      images={specs.images}
      interactiveLayers={specs.interactiveLayers}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      released={!screenFocused}
      onBearingChange={interactive ? handleBearingChange : undefined}
      onMapReady={handleMapReady}
      onRegionIsChanging={handleRegionChanging}
      onRegionDidChange={handleRegionDidChange}
    />
  );

  const attributionOverlay = (
    <AttributionOverlay
      ref={attributionRef}
      initialAttribution={initialAttribution}
      bottomInset={coveredBottom}
      edgeRadius={coveredBottomRadius}
    />
  );

  // Whether to show the interactive control stack (not during trim mode)
  const showControls = interactive;
  const touchThrough = inSlot ? 'box-none' : 'auto';
  const showExpandOverlay = enableFullscreen && !interactive && !onPress;
  const pressable = onPress != null || enableFullscreen;

  return (
    <>
      {interactive ? (
        // Interactive map with control stack and optional 3D
        // A slot's surface sits under this view, so touches the overlays leave go through to it.
        <View style={[styles.outerContainer, { height }]} pointerEvents={touchThrough}>
          <View
            testID="section-map-container"
            style={styles.container}
            pointerEvents={touchThrough}
          >
            {/* 2D Map layer. Unmounted once the 3D layer covers it, because a
                hidden WebView holds its GL context and tile textures. */}
            {show2DSurface ? (
              <View style={styles.mapLayer} pointerEvents={touchThrough}>
                {mapContent}
              </View>
            ) : null}

            {/* 3D Map layer */}
            {is3DMode && hasRoute ? (
              <ComponentErrorBoundary
                part="map3d"
                debugName="3D Map"
                onError={() => setIs3DMode(false)}
              >
                <Animated.View
                  style={[styles.mapLayer, styles.map3DLayer, { opacity: map3DOpacity }]}
                  pointerEvents={is3DReady ? 'auto' : 'none'}
                >
                  <Map3DWebView
                    ref={map3DRef}
                    coordinates={sectionCoords}
                    mapStyle={drawnMapStyle}
                    routeColor={palette.route}
                    fitPadding={fitPadding}
                    frameSize={frameSize}
                    sectionTrimGeoJSON={sectionTrimGeoJSON}
                    highlightedTraceGeoJSON={overlays3D.highlightGeoJSON}
                    released={!screenFocused}
                    onMapReady={handleMap3DReady}
                    onMapFailed={handleMap3DFailed}
                    onTerrainUnavailable={onTerrainUnavailable}
                    onBearingChange={handleBearingChange}
                    onCameraStateChange={handleCamera3DChange}
                  />
                </Animated.View>
              </ComponentErrorBoundary>
            ) : null}

            {terrainNotice}
          </View>

          {attributionOverlay}

          {/* Control buttons - rendered OUTSIDE map container for reliable touch handling */}
          {showControls ? (
            <View
              testID="section-map-controls"
              style={[
                styles.controlsContainer,
                { top: overlayTop, maxHeight: controlsMaxHeight, width: controlsWidth },
              ]}
            >
              {/* Style toggle */}
              <MapControlButton
                testID="section-map-style-toggle"
                accessibilityLabel={t('maps.toggleStyle')}
                onPress={toggleMapStyle}
              >
                <MapControlButton.Glyph name={getStyleIcon(drawnMapStyle)} />
              </MapControlButton>

              {/* 3D toggle */}
              {hasRoute ? (
                <MapControlButton
                  testID="section-map-3d-toggle"
                  accessibilityLabel={t(is3DMode ? 'maps.disable3D' : 'maps.enable3D')}
                  accessibilityState={{ busy: is3DLoading }}
                  selected={is3DMode}
                  onPress={toggle3D}
                  disabled={is3DLoading}
                >
                  {is3DLoading ? (
                    <MapControlButton.Spinner testID="section-map-3d-busy" />
                  ) : (
                    <MapControlButton.Glyph name="terrain" />
                  )}
                </MapControlButton>
              ) : null}

              {/* Compass */}
              <MapControlButton
                testID="section-map-compass"
                accessibilityLabel={t('maps.resetOrientation')}
                onPress={resetOrientation}
              >
                <MapControlButton.Compass rotation={bearingAnim} />
              </MapControlButton>

              {/* GPS location */}
              <MapControlButton
                accessibilityLabel={t('maps.goToLocation')}
                accessibilityState={{ busy: locationLoading }}
                selected={userLocation !== null}
                onPress={handleGetLocation}
                disabled={locationLoading}
              >
                {locationLoading ? (
                  <MapControlButton.Spinner />
                ) : (
                  <MapControlButton.Glyph name={LOCATE_GLYPH} />
                )}
              </MapControlButton>

              {/* Fullscreen expand (hidden during trim mode) */}
              {enableFullscreen && !isTrimming ? (
                <MapControlButton
                  testID="section-map-fullscreen"
                  accessibilityLabel={t('maps.openFullscreen')}
                  onPress={openFullscreen}
                >
                  <MapControlButton.Glyph name="fullscreen" />
                </MapControlButton>
              ) : null}
            </View>
          ) : null}

          {/* The layers drawn over the section's own line, named. */}
          {interactive && hasLegendLayers(legendLayers) ? (
            <DetailMapLegend
              isDark={isDark}
              palette={palette}
              top={overlayTop}
              testID="section-map-legend"
              pickedAttempt={pickedAttempt}
              {...legendLayers}
            />
          ) : null}
        </View>
      ) : (
        // A preview: a tap opens fullscreen, or what the caller passed instead
        <PressTarget
          style={[styles.container, { height }]}
          accessibilityRole="button"
          accessibilityLabel={
            onPress ? (pressLabel ?? t('maps.openFullscreen')) : t('maps.openFullscreen')
          }
          accessibilityState={{ disabled: !pressable }}
          onPress={onPress ?? openFullscreen}
          disabled={!pressable}
        >
          {mapContent}
          {attributionOverlay}
          {showExpandOverlay ? (
            <View style={styles.expandOverlay}>
              <Icon name="fullscreen" size={iconSize.md} color={colors.textOnFill} />
            </View>
          ) : null}
        </PressTarget>
      )}

      {/* Fullscreen modal using BaseMapView */}
      <FullWindowModal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <StatusBar barStyle={`${statusBarStyleForMap(drawnMapStyle)}-content`} />
        <BaseMapView
          routeCoordinates={sectionCoords}
          routeContext={!!(highlightedActivityId || sectionLayerData.highlightedTraceGeoJSON)}
          routeGradient={fullscreenGradient}
          bounds={bounds || undefined}
          initialStyle={currentMapStyle}
          onClose={closeFullscreen}
          overlaySources={fullscreenSources}
          overlayLayers={fullscreenLayers}
          overlayImages={ENDPOINT_AND_DIRECTION_IMAGES}
          layer3D={fullscreenLayer3D}
        />
        {hasLegendLayers(legendLayers) && (
          <DetailMapLegend
            isDark={isDark}
            palette={palette}
            testID="section-map-legend"
            top={fullscreenInsets.top + spacing.sm}
            pickedAttempt={pickedAttempt}
            {...legendLayers}
          />
        )}
      </FullWindowModal>
    </>
  );
});
