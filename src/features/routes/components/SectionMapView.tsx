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
import {
  View,
  Pressable,
  StatusBar,
  Animated,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { getActivityColor } from '@/shared/activity/activityUtils';
import {
  cameraMove,
  colorWithOpacity,
  colors,
  duration,
  iconSize,
  opacity,
  spacing,
  themePalette,
} from '@/theme';
import { useMapPreferences } from '@/features/settings';
import { useTheme } from '@/shared/app';
import {
  BaseMapView,
  type BaseMap3DLayer,
  boundsOfLngLat,
  ENDPOINT_IMAGES,
  featureCollection,
  getNextStyle,
  getStyleIcon,
  statusBarStyleForMap,
  lngLatFromShort,
  lngLatFromShortPoint,
  Map3DWebView,
  type Map3DWebViewRef,
  type MapCameraState,
  MapSurface,
  type MapSurfaceRef,
  pointFeature,
  TRIM_UPDATE_THROTTLE_MS,
  useMapFullscreen,
  useDrawnMapStyle,
  useTerrainFallback,
  useThrottledValue,
  buildSectionTrimCollection,
  EMPTY_FEATURE_COLLECTION,
  cameraAfter3D,
  type Camera3DState,
  buildUserLocationCollection,
  useLocateUser,
  mapControlColumnLayout,
  visibleMapInset,
} from '@/features/maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompassArrow, ComponentErrorBoundary } from '@/shared/ui';
import type { FrequentSection, RoutePoint, ActivityType } from '@/types';
import { toActivityType } from '@/features/routes/types';
import { onlySport } from '@/shared/activity/sportSet';
import { useSectionMapLayers } from './useSectionMapLayers';
import { buildSection3DOverlays } from './sectionMap3DOverlays';
import { buildDeltaLineStops, LOCATE_GLYPH } from '@/features/maps';
import type { SectionDeltaLine } from '../lib/deltaLayout';
import { DetailMapLegend, hasLegendLayers } from './DetailMapLegend';
import { buildSectionLayers, buildSectionSources } from './sectionMapLayerSpecs';
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
  /** The attempt the chart's delta plot shows. While set, the section line is coloured by it. */
  deltaLine?: SectionDeltaLine | null | undefined;
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
  deltaLine = null,
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
  const drawnMapStyle = useDrawnMapStyle(currentMapStyle);
  const activityColor = getActivityColor(validSportType ?? 'Other');
  const surfaceRef = useRef<MapSurfaceRef>(null);
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
  const handleRegionDidChange = useCallback((state: MapCameraState) => {
    settledCameraRef.current = { center: state.center, zoom: state.zoom };
  }, []);

  // Interactive-mode state
  const [is3DMode, setIs3DMode] = useState(false);
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
  // which hold the GL context and every tile texture in it.
  const screenFocused = useIsFocused();
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
  const bounds = useMemo(
    () =>
      boundsOfLngLat(
        extensionCoords.length > 0 ? extensionCoords : sectionCoords,
        SECTION_MAP_BOUNDS_PADDING
      ),
    [extensionCoords, sectionCoords]
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
  } = mapControlColumnLayout(controlCount, height, overlayTop);
  // The section is fitted to what the header and, when it is drawn, the control column leave visible.
  const { width: mapWidth } = useWindowDimensions();
  const fitPadding = useMemo(
    () =>
      visibleMapInset({
        width: mapWidth,
        height,
        coveredTop: overlayTop,
        coveredRight: interactive ? controlsFootprint : 0,
        margin: SECTION_MAP_FIT_PADDING,
      }),
    [mapWidth, height, overlayTop, interactive, controlsFootprint]
  );
  // Controls and legends over the map follow the app theme, not the base drawn under them.
  const { isDark } = useTheme();
  const activeControl = { backgroundColor: themePalette(isDark).primary };

  // The 2D surface comes down once the 3D layer covers it, so where it was is
  // captured on the way out and handed back to the remount.
  const show2DSurface = !(is3DMode && is3DReady);
  const is3DLoading = is3DMode && !is3DReady;
  useEffect(() => {
    if (!show2DSurface) setCameraOnHide(settledCameraRef.current);
  }, [show2DSurface]);

  // Stop in-flight animations on unmount
  useEffect(() => {
    return () => {
      map3DOpacity.stopAnimation();
      bearingAnim.stopAnimation();
    };
  }, [map3DOpacity, bearingAnim]);

  // Frame each section once, and again on entering or leaving expand mode.
  // Keying the refit on the geometry took the camera back on every `sections`
  // event, because the detail bundle hands down a fresh `polyline` array of the
  // same points, so panning the map was undone by the next sync. Extending
  // further inside expand mode is the athlete moving the handle rather than a
  // mode change, so it leaves the viewport alone too.
  const isExpanding = extensionCoords.length > 0;
  const frameKey = `${section.id}|${isExpanding}`;
  const framedSection = useRef<string | null>(null);
  useEffect(() => {
    if (framedSection.current === frameKey) return;
    const nextBounds = boundsOfLngLat(
      isExpanding ? extensionCoords : sectionCoords,
      SECTION_MAP_BOUNDS_PADDING
    );
    if (!nextBounds) return;
    framedSection.current = frameKey;
    surfaceRef.current?.fitBounds(nextBounds, fitPadding, cameraMove.move);
  }, [frameKey, extensionCoords, sectionCoords, isExpanding, fitPadding]);

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

  // Toggle map style
  const toggleMapStyle = useCallback(() => {
    setCurrentMapStyle((current) => getNextStyle(current));
  }, []);

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

  const deltaLineStops = useMemo(
    () =>
      deltaLine
        ? buildDeltaLineStops(
            deltaLine.splits,
            deltaLine.splitStepM,
            deltaLine.sectionLengthM,
            deltaLine.direction
          )
        : null,
    [deltaLine]
  );

  const legendLayers = {
    showActivity:
      sectionLayerData.highlightedTraceGeoJSON !== EMPTY_FEATURE_COLLECTION ||
      sectionLayerData.highlightedTraceFilter !== undefined,
    showEarlierVersion: sectionLayerData.shadowGeoJSON !== EMPTY_FEATURE_COLLECTION,
  };
  const pickedAttempt = {
    activityId: highlightedActivityId,
    date: highlightedActivityDate,
    pageActivityId,
  };
  // The inline map draws the section line itself; the fullscreen modal draws
  // it through the base map and carries no delta colouring.
  const inlineLegendLayers = {
    ...legendLayers,
    showDelta: deltaLineStops !== null,
  };
  const fullscreenLegendLayers = { ...legendLayers, showDelta: false };

  // Adjust opacity when something is highlighted or trimming
  const sectionOpacity = highlightedActivityId || highlightedLapPoints || trimRange ? 0.4 : 1;

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
      deltaLineStops,
      trimmedGeoJSON,
      endpoints,
      activityColor,
      sectionOpacity,
      trimRange,
      hasExtension: extensionCoords.length > 0,
    }),
    [
      sectionLayerData,
      deltaLineStops,
      trimmedGeoJSON,
      endpoints,
      activityColor,
      sectionOpacity,
      trimRange,
      extensionCoords.length,
    ]
  );

  const userLocationGeoJSON = useMemo(
    () => buildUserLocationCollection(userLocation),
    [userLocation]
  );

  const inlineSources = useMemo(
    () =>
      buildSectionSources({
        ...specInput,
        userLocationGeoJSON,
        showExtensionAndSection: true,
        trimCasingWidth: 5,
        trimLineWidth: 4,
        traceCasingWidth: 5,
        traceLineWidth: 4,
      }),
    [specInput, userLocationGeoJSON]
  );

  const inlineLayers = useMemo(
    () =>
      buildSectionLayers({
        ...specInput,
        userLocationGeoJSON,
        hasUserLocation: userLocation !== null,
        showExtensionAndSection: true,
        trimCasingWidth: 5,
        trimLineWidth: 4,
        traceCasingWidth: 5,
        traceLineWidth: 4,
      }),
    [specInput, userLocationGeoJSON, userLocation]
  );

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
  const fullscreenLayers = useMemo(
    () => (isFullscreen ? buildSectionLayers(fullscreenSpecArgs) : EMPTY_LAYERS),
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
        <MaterialCommunityIcons name="map-marker-off" size={iconSize.xl} color={activityColor} />
      </View>
    );
  }

  const mapContent = (
    <MapSurface
      ref={surfaceRef}
      mapStyle={drawnMapStyle}
      initialCamera={
        cameraAfter3D(camera3DRef.current, cameraOnHide) ?? {
          ...sectionCameraSpec(bounds, fitPadding),
          maxZoom: SECTION_MAP_MAX_ZOOM,
        }
      }
      sources={inlineSources}
      layers={inlineLayers}
      images={ENDPOINT_IMAGES}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      released={!screenFocused}
      onBearingChange={interactive ? handleBearingChange : undefined}
      onRegionDidChange={handleRegionDidChange}
    />
  );

  // Whether to show the interactive control stack (not during trim mode)
  const showControls = interactive;
  const showExpandOverlay = enableFullscreen && !interactive;

  return (
    <>
      {interactive ? (
        // Interactive map with control stack and optional 3D
        <View style={[styles.outerContainer, { height }]}>
          <View testID="section-map-container" style={styles.container}>
            {/* 2D Map layer. Unmounted once the 3D layer covers it, because a
                hidden WebView holds its GL context and tile textures. */}
            {show2DSurface ? <View style={styles.mapLayer}>{mapContent}</View> : null}

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
                    routeColor={activityColor}
                    fitPadding={fitPadding}
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
              <Pressable
                testID="section-map-style-toggle"
                accessibilityRole="button"
                accessibilityLabel={t('maps.toggleStyle')}
                style={pressable([styles.controlButton, isDark && styles.controlButtonDark])}
                onPress={toggleMapStyle}
                android_ripple={pressRipple}
              >
                <MaterialCommunityIcons
                  name={getStyleIcon(drawnMapStyle)}
                  size={iconSize.lg}
                  color={isDark ? colors.textOnDark : colors.textSecondary}
                />
              </Pressable>

              {/* 3D toggle */}
              {hasRoute ? (
                <Pressable
                  testID="section-map-3d-toggle"
                  accessibilityRole="button"
                  accessibilityLabel={t(is3DMode ? 'maps.disable3D' : 'maps.enable3D')}
                  accessibilityState={{
                    selected: is3DMode,
                    busy: is3DLoading,
                    disabled: is3DLoading,
                  }}
                  style={pressable([
                    styles.controlButton,
                    isDark && styles.controlButtonDark,
                    is3DMode && activeControl,
                  ])}
                  onPress={toggle3D}
                  disabled={is3DLoading}
                  android_ripple={pressRipple}
                >
                  {is3DLoading ? (
                    <ActivityIndicator
                      testID="section-map-3d-busy"
                      size="small"
                      color={colors.textOnDark}
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="terrain"
                      size={iconSize.lg}
                      color={
                        is3DMode
                          ? colors.textOnDark
                          : isDark
                            ? colors.textOnDark
                            : colors.textSecondary
                      }
                    />
                  )}
                </Pressable>
              ) : null}

              {/* Compass */}
              <Pressable
                testID="section-map-compass"
                style={pressable([styles.controlButton, isDark && styles.controlButtonDark])}
                accessibilityRole="button"
                accessibilityLabel={t('maps.resetOrientation')}
                onPress={resetOrientation}
                android_ripple={pressRipple}
              >
                <CompassArrow
                  size={iconSize.lg}
                  rotation={bearingAnim}
                  northColor={colors.error}
                  southColor={isDark ? colors.textOnDark : colors.textSecondary}
                />
              </Pressable>

              {/* GPS location */}
              <Pressable
                style={pressable([
                  styles.controlButton,
                  isDark && styles.controlButtonDark,
                  userLocation !== null && activeControl,
                ])}
                accessibilityRole="button"
                accessibilityLabel={t('maps.goToLocation')}
                accessibilityState={{ disabled: locationLoading }}
                onPress={locationLoading ? undefined : handleGetLocation}
                disabled={locationLoading}
                android_ripple={pressRipple}
              >
                {locationLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={isDark ? colors.textOnDark : colors.textSecondary}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={LOCATE_GLYPH}
                    size={iconSize.lg}
                    color={isDark ? colors.textOnDark : colors.textSecondary}
                  />
                )}
              </Pressable>

              {/* Fullscreen expand (hidden during trim mode) */}
              {enableFullscreen && !isTrimming ? (
                <Pressable
                  testID="section-map-fullscreen"
                  accessibilityRole="button"
                  accessibilityLabel={t('maps.openFullscreen')}
                  style={pressable([styles.controlButton, isDark && styles.controlButtonDark])}
                  onPress={openFullscreen}
                  android_ripple={pressRipple}
                >
                  <MaterialCommunityIcons
                    name="fullscreen"
                    size={iconSize.lg}
                    color={isDark ? colors.textOnDark : colors.textSecondary}
                  />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* The layers drawn over the section's own line, named. */}
          {interactive && hasLegendLayers(inlineLegendLayers) ? (
            <DetailMapLegend
              isDark={isDark}
              top={overlayTop}
              testID="section-map-legend"
              pickedAttempt={pickedAttempt}
              {...inlineLegendLayers}
            />
          ) : null}
        </View>
      ) : (
        // Non-interactive map - tap anywhere to fullscreen
        <Pressable
          style={pressable([styles.container, { height }])}
          accessibilityRole="button"
          accessibilityLabel={t('maps.openFullscreen')}
          accessibilityState={{ disabled: !enableFullscreen }}
          onPress={openFullscreen}
          disabled={!enableFullscreen}
          android_ripple={pressRipple}
        >
          {mapContent}
          {showExpandOverlay ? (
            <View style={styles.expandOverlay}>
              <MaterialCommunityIcons
                name="fullscreen"
                size={iconSize.md}
                color={colors.textOnDark}
              />
            </View>
          ) : null}
        </Pressable>
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
          routeColor={
            highlightedActivityId || sectionLayerData.highlightedTraceGeoJSON
              ? colorWithOpacity(activityColor, opacity.dim)
              : activityColor
          }
          bounds={bounds || undefined}
          initialStyle={currentMapStyle}
          onClose={closeFullscreen}
          overlaySources={fullscreenSources}
          overlayLayers={fullscreenLayers}
          overlayImages={ENDPOINT_IMAGES}
          layer3D={fullscreenLayer3D}
        />
        {hasLegendLayers(fullscreenLegendLayers) && (
          <DetailMapLegend
            isDark={isDark}
            testID="section-map-legend"
            top={fullscreenInsets.top + spacing.sm}
            pickedAttempt={pickedAttempt}
            {...fullscreenLegendLayers}
          />
        )}
      </FullWindowModal>
    </>
  );
});
