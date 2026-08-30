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
  Text,
  TouchableOpacity,
  Modal,
  StatusBar,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { getActivityColor } from '@/features/activity/lib/activityUtils';
import { colors, darkColors } from '@/theme';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import {
  BaseMapView,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
  MapSurface,
  type MapSurfaceRef,
} from '@/features/maps/components';
import { Map3DWebView, type Map3DWebViewRef } from '@/features/maps/components/Map3DWebView';
import { CompassArrow, ComponentErrorBoundary } from '@/shared/ui';
import { useMapFullscreen } from '@/features/maps/hooks/useMapFullscreen';
import { useThrottledValue } from '@/features/maps/hooks/useThrottledValue';
import {
  boundsOfLngLat,
  featureCollection,
  lngLatFromShort,
  lngLatFromShortPoint,
  pointFeature,
} from '@/features/maps/lib/coordinates';
import { TRIM_UPDATE_THROTTLE_MS } from '@/features/maps/lib/mapBudgets';
import { decodeCoords } from 'veloqrs';
import type { FrequentSection, RoutePoint, ActivityType } from '@/types';
import { useSectionMapLayers, type NearbyPolyline } from './useSectionMapLayers';
import {
  buildSectionLayers,
  buildSectionSources,
  NEARBY_LINE_LAYER_ID,
} from './sectionMapLayerSpecs';
import {
  SECTION_MAP_BOUNDS_PADDING,
  SECTION_MAP_FIT_PADDING,
  SECTION_MAP_MAX_ZOOM,
  sectionCameraSpec,
} from '@/features/routes/lib/sectionMapCamera';
import { styles } from './sectionMapView.styles';

/**
 * Type guard to validate sport type strings from Rust engine.
 * Ensures string matches known ActivityType values.
 *
 * @param sportType - Unknown string from Rust engine
 * @returns True if string is a valid ActivityType
 */
function isValidActivityType(sportType: string): sportType is ActivityType {
  const validTypes: Set<string> = new Set([
    'Ride',
    'Run',
    'Swim',
    'Walk',
    'Hike',
    'VirtualRide',
    'VirtualRun',
    'Workout',
    'WeightTraining',
    'Yoga',
    'Snowboard',
    'AlpineSki',
    'NordicSki',
    'BackcountrySki',
    'Rowing',
    'Kayaking',
    'Canoeing',
    'OpenWaterSwim',
    'TrailRun',
  ]);
  return validTypes.has(sportType);
}

interface SectionMapViewProps {
  section: FrequentSection;
  height?: number;
  /** Enable map interaction (zoom, pan). Default false for preview, true for detail. */
  interactive?: boolean;
  /** Enable tap to fullscreen */
  enableFullscreen?: boolean;
  /** Optional full activity track to show as a shadow behind the section */
  shadowTrack?: [number, number][];
  /** Activity ID to highlight (show prominently) */
  highlightedActivityId?: string | null;
  /** Specific lap points to highlight (takes precedence over highlightedActivityId) */
  highlightedLapPoints?: RoutePoint[];
  /**
   * Pre-loaded activity traces for fast scrubbing.
   * When provided, all traces are rendered in a single FeatureCollection
   * and a filter expression is used to show only the highlighted one.
   * This avoids expensive shape geometry updates during scrubbing.
   */
  allActivityTraces?: Record<string, RoutePoint[]>;
  /** Trim range for bounds editing - when set, shows full polyline faded + trimmed portion highlighted */
  trimRange?: { start: number; end: number } | null;
  /** Extension track for expanding section bounds - shown as faded line beyond the section */
  extensionTrack?: RoutePoint[] | null;
  /** Nearby section polylines to render as muted gray overlays. Each entry has encoded coords. */
  nearbyPolylines?: NearbyPolyline[];
  /** Called when a nearby section polyline is tapped */
  onNearbyPress?: (sectionId: string) => void;
}

export const SectionMapView = memo(function SectionMapView({
  section,
  height = 200,
  interactive = false,
  enableFullscreen = false,
  shadowTrack,
  highlightedActivityId = null,
  highlightedLapPoints,
  allActivityTraces,
  trimRange = null,
  extensionTrack = null,
  nearbyPolylines,
  onNearbyPress,
}: SectionMapViewProps) {
  const { t } = useTranslation();
  const { isFullscreen, openFullscreen, closeFullscreen } = useMapFullscreen({ enableFullscreen });
  const [selectedNearby, setSelectedNearby] = useState<string | null>(null);
  const { getStyleForActivity } = useMapPreferences();

  // Validate sport type from Rust engine, fallback to 'Ride' if invalid
  // This prevents crashes when native module returns unexpected sport types
  const validSportType: ActivityType = isValidActivityType(section.sportType)
    ? section.sportType
    : 'Ride'; // Safe fallback

  const preferredStyle = getStyleForActivity(validSportType);
  const [currentMapStyle, setCurrentMapStyle] = useState(preferredStyle);
  const activityColor = getActivityColor(validSportType);
  const surfaceRef = useRef<MapSurfaceRef>(null);

  // Interactive-mode state
  const [is3DMode, setIs3DMode] = useState(false);
  const [is3DReady, setIs3DReady] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const map3DOpacity = useRef(new Animated.Value(0)).current;
  const bearingAnim = useRef(new Animated.Value(0)).current;

  const displayPoints = section.polyline || [];
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
  const isDark = isDarkStyle(currentMapStyle);

  // Stop in-flight animations on unmount
  useEffect(() => {
    return () => {
      map3DOpacity.stopAnimation();
      bearingAnim.stopAnimation();
    };
  }, [map3DOpacity, bearingAnim]);

  // Refit camera when extension track changes (entering/leaving expand mode)
  useEffect(() => {
    const nextBounds = boundsOfLngLat(
      extensionCoords.length > 0 ? extensionCoords : sectionCoords,
      SECTION_MAP_BOUNDS_PADDING
    );
    if (nextBounds) {
      surfaceRef.current?.fitBounds(nextBounds, SECTION_MAP_FIT_PADDING, 500);
    }
  }, [extensionCoords, sectionCoords]);

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
      surfaceRef.current?.setCamera(
        { center: [location.coords.longitude, location.coords.latitude], zoom: 14 },
        500
      );
    } catch {
      setLocationLoading(false);
    }
  }, []);

  const sectionLayerData = useSectionMapLayers({
    section,
    displayPoints,
    shadowTrack,
    highlightedActivityId,
    highlightedLapPoints,
    allActivityTraces,
    trimRange,
    extensionTrack,
    nearbyPolylines,
  });

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

  const nearbyEndpoints = useMemo(() => {
    if (!nearbyPolylines || nearbyPolylines.length === 0) return featureCollection([]);
    return featureCollection(
      nearbyPolylines.flatMap((entry) => {
        if (!entry.encodedPolyline) return [];
        const decoded = decodeCoords(entry.encodedPolyline);
        if (decoded.length < 2) return [];
        const first = decoded[0];
        const last = decoded[decoded.length - 1];
        return [
          pointFeature([first.longitude, first.latitude], { position: 'start' }),
          pointFeature([last.longitude, last.latitude], { position: 'end' }),
        ];
      })
    );
  }, [nearbyPolylines]);

  // Trim drags arrive faster than the map needs. The slider stays smooth on the
  // UI thread while the geometry that reaches the surface is held to a budget.
  const trimmedGeoJSON = useThrottledValue(
    sectionLayerData.trimmedGeoJSON,
    TRIM_UPDATE_THROTTLE_MS
  );

  const specInput = useMemo(
    () => ({
      ...sectionLayerData,
      trimmedGeoJSON,
      nearbyEndpoints,
      endpoints,
      activityColor,
      sectionOpacity,
      trimRange,
      hasExtension: extensionCoords.length > 0,
      selectedNearbyId: selectedNearby,
    }),
    [
      sectionLayerData,
      trimmedGeoJSON,
      nearbyEndpoints,
      endpoints,
      activityColor,
      sectionOpacity,
      trimRange,
      extensionCoords.length,
      selectedNearby,
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

  const fullscreenSources = useMemo(
    () => buildSectionSources(fullscreenSpecArgs),
    [fullscreenSpecArgs]
  );
  const fullscreenLayers = useMemo(
    () => buildSectionLayers(fullscreenSpecArgs),
    [fullscreenSpecArgs]
  );

  const handleSurfacePress = useCallback(
    ({ feature }: { feature: { properties: Record<string, unknown> } | null }) => {
      const sectionId = feature?.properties?.sectionId;
      if (typeof sectionId === 'string') {
        setSelectedNearby((current) => (current === sectionId ? null : sectionId));
      }
    },
    []
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
      mapStyle={currentMapStyle}
      initialCamera={{ ...sectionCameraSpec(bounds), maxZoom: SECTION_MAP_MAX_ZOOM }}
      sources={inlineSources}
      layers={inlineLayers}
      interactiveLayers={NEARBY_INTERACTIVE_LAYERS}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      onPress={handleSurfacePress}
      onBearingChange={interactive ? handleBearingChange : undefined}
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
            {/* 2D Map layer - hidden when 3D is ready */}
            <View style={[styles.mapLayer, is3DMode && is3DReady && styles.hiddenLayer]}>
              {mapContent}
            </View>

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
                    mapStyle={currentMapStyle}
                    routeColor={activityColor}
                    onMapReady={handleMap3DReady}
                    onMapFailed={handleMap3DFailed}
                    onBearingChange={handleBearingChange}
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
            <View style={styles.controlsContainer}>
              {/* Style toggle */}
              <TouchableOpacity
                testID="section-map-style-toggle"
                style={[styles.controlButton, isDark && styles.controlButtonDark]}
                onPressIn={toggleMapStyle}
                activeOpacity={0.6}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <MaterialCommunityIcons
                  name={getStyleIcon(currentMapStyle)}
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

          {/* Nearby section preview popup */}
          {selectedNearby &&
            nearbyPolylines &&
            (() => {
              const nearbySection = nearbyPolylines.find((n) => n.id === selectedNearby);
              if (!nearbySection) return null;
              return (
                <View style={[styles.nearbyPopup, isDark && styles.nearbyPopupDark]}>
                  <View style={styles.nearbyPopupContent}>
                    <View style={styles.nearbyPopupInfo}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.nearbyPopupName,
                          isDark && { color: darkColors.textPrimary },
                        ]}
                      >
                        {nearbySection.name || nearbySection.id.slice(0, 8)}
                      </Text>
                      <Text
                        style={[
                          styles.nearbyPopupMeta,
                          isDark && { color: darkColors.textSecondary },
                        ]}
                      >
                        {Math.round(nearbySection.distanceMeters)}m ·{' '}
                        {t('sections.visitsCount', { count: nearbySection.visitCount })}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.nearbyPopupViewBtn}
                      onPress={() => {
                        setSelectedNearby(null);
                        onNearbyPress?.(nearbySection.id);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.nearbyPopupViewText}>{t('sections.viewSection')}</Text>
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={16}
                        color={colors.primary}
                      />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.nearbyPopupClose}
                    onPress={() => setSelectedNearby(null)}
                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  >
                    <MaterialCommunityIcons
                      name="close"
                      size={18}
                      color={isDark ? darkColors.textSecondary : colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
              );
            })()}
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
      </Modal>
    </>
  );
});

const NEARBY_INTERACTIVE_LAYERS = [NEARBY_LINE_LAYER_ID];
