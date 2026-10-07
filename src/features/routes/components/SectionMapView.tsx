/**
 * Hero map view for section detail page.
 * Displays the section polyline (medoid trace) prominently.
 *
 * Performance optimization: Pre-loads all activity traces as a FeatureCollection
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
  TouchableOpacity,
  Modal,
  StatusBar,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { getActivityColor } from '@/shared/activity/activityUtils';
import { colors, spacing } from '@/theme';
import {
  BaseMapView,
  boundsOfLngLat,
  featureCollection,
  getNextStyle,
  getStyleIcon,
  isDarkStyle,
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
  useMapPreferences,
  useThrottledValue,
  buildSectionTrimCollection,
  EMPTY_FEATURE_COLLECTION,
  cameraAfter3D,
  type Camera3DState,
} from '@/features/maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompassArrow, ComponentErrorBoundary, HERO_HEADER_HEIGHT } from '@/shared/ui';
import type { FrequentSection, RoutePoint, ActivityType } from '@/types';
import { toActivityType } from '@/features/routes/types';
import { onlySport } from '@/shared/activity/sportSet';
import { useSectionMapLayers } from './useSectionMapLayers';
import { buildSection3DOverlays } from './sectionMap3DOverlays';
import { buildDeltaLineStops } from '@/features/maps';
import type { SectionDeltaLine } from '../lib/deltaLayout';
import { SectionMapLegend, hasLegendLayers } from './section/SectionMapLegend';
import { buildSectionLayers, buildSectionSources } from './sectionMapLayerSpecs';
import {
  SECTION_MAP_BOUNDS_PADDING,
  SECTION_MAP_FIT_PADDING,
  SECTION_MAP_MAX_ZOOM,
  sectionCameraSpec,
} from '@/features/routes/lib/sectionMapCamera';
import { styles } from './sectionMapView.styles';

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
   * Top safe-area inset of the screen the map fills. The map draws edge to
   * edge, so the legend and the controls are offset by this and the hero's
   * header row to clear the status bar and the back button.
   */
  insetTop?: number | undefined;
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
  allActivityTraces,
  trimRange = null,
  extensionTrack = null,
  insetTop = 0,
  deltaLine = null,
}: SectionMapViewProps) {
  const { isFullscreen, openFullscreen, closeFullscreen } = useMapFullscreen({ enableFullscreen });
  const { getStyleForActivity, preferences } = useMapPreferences();

  // The first row of the map that is not under the status bar or the hero's
  // back button. Everything floated over the map's top corners starts here.
  const fullscreenInsets = useSafeAreaInsets();
  const overlayTop = insetTop + HERO_HEADER_HEIGHT + spacing.sm;

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
  const settledCameraRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
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
  const [locationLoading, setLocationLoading] = useState(false);
  const map3DRef = useRef<Map3DWebViewRef>(null);
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
  const isDark = isDarkStyle(drawnMapStyle);

  // The 2D surface comes down once the 3D layer covers it, so where it was is
  // captured on the way out and handed back to the remount.
  const show2DSurface = !(is3DMode && is3DReady);
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
    surfaceRef.current?.fitBounds(nextBounds, SECTION_MAP_FIT_PADDING, 500);
  }, [frameKey, extensionCoords, sectionCoords, isExpanding]);

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

  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    Animated.timing(map3DOpacity, {
      toValue: 1,
      duration: 300,
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
    Animated.timing(bearingAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [is3DMode, is3DReady, bearingAnim]);

  // Get user location and refocus camera
  const handleGetLocation = useCallback(async () => {
    try {
      setLocationLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationLoading(false);
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLocationLoading(false);
      const target = is3DMode && is3DReady ? map3DRef.current : surfaceRef.current;
      target?.setCamera(
        { center: [location.coords.longitude, location.coords.latitude], zoom: 14 },
        500
      );
    } catch {
      setLocationLoading(false);
    }
  }, [is3DMode, is3DReady]);

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
  // The inline map draws the section line itself; the fullscreen modal draws
  // it through the base map and carries no delta colouring.
  const inlineLegendLayers = { ...legendLayers, showDelta: deltaLineStops !== null };
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

  const inlineSources = useMemo(
    () =>
      buildSectionSources({
        ...specInput,
        showExtensionAndSection: true,
        trimCasingWidth: 5,
        trimLineWidth: 4,
        traceCasingWidth: 5,
        traceLineWidth: 4,
      }),
    [specInput]
  );

  const inlineLayers = useMemo(
    () =>
      buildSectionLayers({
        ...specInput,
        showExtensionAndSection: true,
        trimCasingWidth: 5,
        trimLineWidth: 4,
        traceCasingWidth: 5,
        traceLineWidth: 4,
      }),
    [specInput]
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

  if (!bounds || displayPoints.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  const mapContent = (
    <MapSurface
      ref={surfaceRef}
      mapStyle={drawnMapStyle}
      initialCamera={
        cameraAfter3D(camera3DRef.current, cameraOnHide) ?? {
          ...sectionCameraSpec(bounds),
          maxZoom: SECTION_MAP_MAX_ZOOM,
        }
      }
      sources={inlineSources}
      layers={inlineLayers}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      onBearingChange={interactive ? handleBearingChange : undefined}
      onRegionDidChange={handleRegionDidChange}
    />
  );

  // Whether to show the interactive control stack (not during trim mode)
  const showControls = interactive;
  const showExpandOverlay = enableFullscreen && !interactive;
  // Fullscreen button is part of control stack when interactive
  const isTrimming = !!trimRange;

  return (
    <>
      {interactive ? (
        // Interactive map with control stack and optional 3D
        <View style={[styles.outerContainer, { height }]}>
          <View testID="section-map-container" style={styles.container}>
            {/* 2D Map layer. Unmounted once the 3D layer covers it, because a
                hidden WebView holds its GL context and tile textures. */}
            {show2DSurface && <View style={styles.mapLayer}>{mapContent}</View>}

            {/* 3D Map layer */}
            {is3DMode && hasRoute && (
              <ComponentErrorBoundary
                componentName="3D Map"
                showRetry={false}
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
                    sectionTrimGeoJSON={sectionTrimGeoJSON}
                    highlightedTraceGeoJSON={overlays3D.highlightGeoJSON}
                    onMapReady={handleMap3DReady}
                    onMapFailed={handleMap3DFailed}
                    onBearingChange={handleBearingChange}
                    onCameraStateChange={handleCamera3DChange}
                  />
                </Animated.View>
              </ComponentErrorBoundary>
            )}

            {/* 3D loading spinner */}
            {is3DMode && !is3DReady && (
              <View style={styles.loadingOverlay} testID="section-map-3d-loading">
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
          </View>

          {/* Control buttons - rendered OUTSIDE map container for reliable touch handling */}
          {showControls && (
            <View
              testID="section-map-controls"
              style={[styles.controlsContainer, { top: overlayTop }]}
            >
              {/* Style toggle */}
              <TouchableOpacity
                testID="section-map-style-toggle"
                style={[styles.controlButton, isDark && styles.controlButtonDark]}
                onPressIn={toggleMapStyle}
                activeOpacity={0.6}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <MaterialCommunityIcons
                  name={getStyleIcon(drawnMapStyle)}
                  size={22}
                  color={isDark ? colors.textOnDark : colors.textSecondary}
                />
              </TouchableOpacity>

              {/* 3D toggle */}
              {hasRoute && (
                <TouchableOpacity
                  testID="section-map-3d-toggle"
                  style={[
                    styles.controlButton,
                    isDark && styles.controlButtonDark,
                    is3DMode && styles.controlButtonActive,
                  ]}
                  onPressIn={toggle3D}
                  activeOpacity={0.6}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <MaterialCommunityIcons
                    name="terrain"
                    size={22}
                    color={
                      is3DMode
                        ? colors.textOnDark
                        : isDark
                          ? colors.textOnDark
                          : colors.textSecondary
                    }
                  />
                </TouchableOpacity>
              )}

              {/* Compass */}
              <TouchableOpacity
                style={[styles.controlButton, isDark && styles.controlButtonDark]}
                onPressIn={resetOrientation}
                activeOpacity={0.6}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <CompassArrow
                  size={22}
                  rotation={bearingAnim}
                  northColor={colors.error}
                  southColor={isDark ? colors.textOnDark : colors.textSecondary}
                />
              </TouchableOpacity>

              {/* GPS location */}
              <TouchableOpacity
                style={[styles.controlButton, isDark && styles.controlButtonDark]}
                onPress={locationLoading ? undefined : handleGetLocation}
                activeOpacity={locationLoading ? 1 : 0.6}
                disabled={locationLoading}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                {locationLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={isDark ? colors.textOnDark : colors.textSecondary}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name="crosshairs-gps"
                    size={22}
                    color={isDark ? colors.textOnDark : colors.textSecondary}
                  />
                )}
              </TouchableOpacity>

              {/* Fullscreen expand (hidden during trim mode) */}
              {enableFullscreen && !isTrimming && (
                <TouchableOpacity
                  testID="section-map-fullscreen"
                  style={[styles.controlButton, isDark && styles.controlButtonDark]}
                  onPressIn={openFullscreen}
                  activeOpacity={0.6}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <MaterialCommunityIcons
                    name="fullscreen"
                    size={22}
                    color={isDark ? colors.textOnDark : colors.textSecondary}
                  />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* The layers drawn over the section's own line, named. */}
          {interactive && hasLegendLayers(inlineLegendLayers) && (
            <SectionMapLegend isDark={isDark} top={overlayTop} {...inlineLegendLayers} />
          )}
        </View>
      ) : (
        // Non-interactive map - tap anywhere to fullscreen
        <TouchableOpacity
          style={[styles.container, { height }]}
          onPress={openFullscreen}
          activeOpacity={enableFullscreen ? 0.9 : 1}
          disabled={!enableFullscreen}
        >
          {mapContent}
          {showExpandOverlay && (
            <View style={styles.expandOverlay}>
              <MaterialCommunityIcons name="fullscreen" size={20} color={colors.textOnDark} />
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Fullscreen modal using BaseMapView */}
      <Modal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <BaseMapView
          routeCoordinates={sectionCoords}
          routeColor={
            highlightedActivityId || sectionLayerData.highlightedTraceGeoJSON
              ? activityColor + '66'
              : activityColor
          }
          bounds={bounds || undefined}
          initialStyle={currentMapStyle}
          onClose={closeFullscreen}
          overlaySources={fullscreenSources}
          overlayLayers={fullscreenLayers}
        />
        {hasLegendLayers(fullscreenLegendLayers) && (
          <SectionMapLegend
            isDark={isDark}
            top={fullscreenInsets.top + spacing.sm}
            {...fullscreenLegendLayers}
          />
        )}
      </Modal>
    </>
  );
});
