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
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  MarkerView,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { getActivityColor, getBoundsFromPoints } from '@/lib';
import { colors, darkColors } from '@/theme';
import { useMapPreferences } from '@/providers';
import {
  getMapStyle,
  BaseMapView,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
} from '@/features/maps/components';
import { Map3DWebView, type Map3DWebViewRef } from '@/features/maps/components/Map3DWebView';
import { CompassArrow, ComponentErrorBoundary } from '@/shared/ui';
import { useMapFullscreen } from '@/features/maps/hooks/useMapFullscreen';
import { decodeCoords } from 'veloqrs';
import type { FrequentSection, RoutePoint, ActivityType } from '@/types';
import { useSectionMapLayers, type NearbyPolyline } from './useSectionMapLayers';
import { SectionTrimLayer } from './SectionTrimLayer';
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
  /** Whether user is actively scrubbing - skips expensive renders during scrub */
  isScrubbing?: boolean;
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
  isScrubbing = false,
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
  const mapRef = useRef(null);

  // Interactive-mode state
  const [is3DMode, setIs3DMode] = useState(false);
  const [is3DReady, setIs3DReady] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const map3DOpacity = useRef(new Animated.Value(0)).current;
  const bearingAnim = useRef(new Animated.Value(0)).current;
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);

  const displayPoints = section.polyline || [];

  // When extension track is active (expand mode), calculate bounds from the full context window
  // so the camera shows the entire expandable area, not just the section portion
  const boundsPoints = useMemo(() => {
    if (extensionTrack && extensionTrack.length > 0) {
      return extensionTrack;
    }
    return displayPoints;
  }, [extensionTrack, displayPoints]);

  const bounds = useMemo(() => getBoundsFromPoints(boundsPoints, 0.15), [boundsPoints]);

  // Section coordinates for 3D map and BaseMapView [lng, lat] format
  const sectionCoords = useMemo(() => {
    return displayPoints.map((p) => [p.lng, p.lat] as [number, number]);
  }, [displayPoints]);

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
    if (!cameraRef.current) return;
    const newBounds =
      extensionTrack && extensionTrack.length > 0
        ? getBoundsFromPoints(extensionTrack, 0.15)
        : getBoundsFromPoints(displayPoints, 0.15);
    if (newBounds) {
      cameraRef.current.setCamera({
        bounds: { ne: newBounds.ne, sw: newBounds.sw },
        padding: { paddingTop: 80, paddingRight: 80, paddingBottom: 80, paddingLeft: 80 },
        animationDuration: 500,
      });
    }
  }, [extensionTrack, displayPoints]);

  // Reset 3D ready state when toggling off
  useEffect(() => {
    if (!is3DMode) {
      setIs3DReady(false);
      map3DOpacity.setValue(0);
    }
  }, [is3DMode, map3DOpacity]);

  // Handle 3D map ready - fade in the 3D view
  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    Animated.timing(map3DOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [map3DOpacity]);

  // Handle 3D map bearing changes (for compass sync)
  const handleBearingChange = useCallback(
    (bearing: number) => {
      bearingAnim.setValue(-bearing);
    },
    [bearingAnim]
  );

  // Handle region change for compass (real-time during gesture)
  const handleRegionIsChanging = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as { heading?: number } | undefined;
      if (properties?.heading !== undefined) {
        bearingAnim.setValue(-properties.heading);
      }
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
      cameraRef.current?.setCamera({
        heading: 0,
        animationDuration: 300,
      });
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
      const coords: [number, number] = [location.coords.longitude, location.coords.latitude];
      setLocationLoading(false);
      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 14,
        animationDuration: 500,
      });
    } catch {
      setLocationLoading(false);
    }
  }, []);

  const {
    sectionGeoJSON,
    trimmedGeoJSON,
    shadowGeoJSON,
    extensionGeoJSON,
    nearbyGeoJSON,
    allTracesFeatureCollection,
    hasAllTraces,
    highlightedTraceFilter,
    highlightedTraceGeoJSON,
    highlightedLapGeoJSON,
  } = useSectionMapLayers({
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

  const styleUrl = getMapStyle(currentMapStyle);

  // Use trimmed positions for markers when trimming
  // In expand mode, indices are relative to the extension track, not the section polyline
  const markerSource =
    trimRange && extensionTrack && extensionTrack.length > 0 ? extensionTrack : displayPoints;
  const startPoint = trimRange ? markerSource[trimRange.start] : displayPoints[0];
  const endPoint = trimRange
    ? markerSource[trimRange.end]
    : displayPoints[displayPoints.length - 1];

  if (!bounds || displayPoints.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  const mapContent = (
    <MapView
      ref={mapRef}
      style={styles.map}
      mapStyle={styleUrl}
      logoEnabled={false}
      attributionEnabled={false}
      compassEnabled={false}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={false}
      onRegionIsChanging={interactive ? handleRegionIsChanging : undefined}
    >
      <Camera
        maxZoomLevel={16}
        ref={interactive ? cameraRef : undefined}
        defaultSettings={{
          bounds: { ne: bounds.ne, sw: bounds.sw },
          padding: { paddingTop: 80, paddingRight: 80, paddingBottom: 80, paddingLeft: 80 },
        }}
      />

      {/* Nearby section polylines (muted gray, tappable for preview) */}
      <ShapeSource
        id="nearbySource"
        shape={nearbyGeoJSON}
        onPress={(e) => {
          const feature = e?.features?.[0];
          const sectionId = feature?.properties?.sectionId;
          if (sectionId) {
            setSelectedNearby(selectedNearby === sectionId ? null : sectionId);
          }
        }}
        hitbox={{ width: 20, height: 20 }}
      >
        <LineLayer
          id="nearbyLine"
          style={{
            lineColor: [
              'case',
              ['==', ['get', 'sectionId'], selectedNearby ?? ''],
              colors.primary,
              '#888888',
            ],
            lineOpacity: ['case', ['==', ['get', 'sectionId'], selectedNearby ?? ''], 0.8, 0.4],
            lineWidth: ['case', ['==', ['get', 'sectionId'], selectedNearby ?? ''], 5, 3],
            lineCap: 'round',
            lineJoin: 'round',
            lineDasharray: [2, 2],
          }}
        />
      </ShapeSource>

      {/* Start/end markers for nearby sections */}
      {nearbyPolylines?.map((entry) => {
        if (!entry.encodedPolyline) return null;
        const decoded = decodeCoords(entry.encodedPolyline);
        if (decoded.length < 2) return null;
        const startCoord: [number, number] = [decoded[0].longitude, decoded[0].latitude];
        const last = decoded[decoded.length - 1];
        const endCoord: [number, number] = [last.longitude, last.latitude];
        return (
          <React.Fragment key={`nearby-markers-${entry.id}`}>
            <MarkerView coordinate={startCoord}>
              <View style={styles.markerContainer}>
                <View style={[styles.nearbyMarker, styles.nearbyStartMarker]} />
              </View>
            </MarkerView>
            <MarkerView coordinate={endCoord}>
              <View style={styles.markerContainer}>
                <View style={[styles.nearbyMarker, styles.nearbyEndMarker]} />
              </View>
            </MarkerView>
          </React.Fragment>
        );
      })}

      <SectionTrimLayer
        idPrefix="inline"
        shadowGeoJSON={shadowGeoJSON}
        extensionGeoJSON={extensionGeoJSON}
        sectionGeoJSON={sectionGeoJSON}
        trimmedGeoJSON={trimmedGeoJSON}
        activityColor={activityColor}
        sectionOpacity={sectionOpacity}
        trimRange={trimRange}
        extensionTrack={extensionTrack}
        showExtensionAndSection
        trimCasingWidth={5}
        trimLineWidth={4}
      />

      {/* Pre-loaded activity traces with filter */}
      <ShapeSource id="allTracesSource" shape={allTracesFeatureCollection}>
        <LineLayer
          id="allTracesLineCasing"
          filter={highlightedTraceFilter}
          style={{
            lineColor: '#FFFFFF',
            lineWidth: 5,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: hasAllTraces && highlightedTraceFilter ? 1 : 0,
          }}
        />
        <LineLayer
          id="allTracesLine"
          filter={highlightedTraceFilter}
          style={{
            lineColor: colors.chartCyan,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: hasAllTraces && highlightedTraceFilter ? 1 : 0,
          }}
        />
      </ShapeSource>

      {/* Highlighted lap points overlay */}
      <ShapeSource id="highlightedLapSource" shape={highlightedLapGeoJSON}>
        <LineLayer
          id="highlightedLapLineCasing"
          style={{
            lineColor: '#FFFFFF',
            lineOpacity: 1,
            lineWidth: 6,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <LineLayer
          id="highlightedLapLine"
          style={{
            lineColor: colors.chartCyan,
            lineWidth: 5,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>

      {/* Fallback: Highlighted activity trace */}
      <ShapeSource id="highlightedSource" shape={highlightedTraceGeoJSON}>
        <LineLayer
          id="highlightedLineCasing"
          style={{
            lineColor: '#FFFFFF',
            lineOpacity: 1,
            lineWidth: 5,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <LineLayer
          id="highlightedLine"
          style={{
            lineColor: colors.chartCyan,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>

      {/* Start marker */}
      {/* iOS CRASH FIX: Always render MarkerView to maintain stable child count */}
      {/* Use opacity to hide when point is undefined */}
      <MarkerView coordinate={startPoint ? [startPoint.lng, startPoint.lat] : [0, 0]}>
        <View style={[styles.markerContainer, { opacity: startPoint ? 1 : 0 }]}>
          <View style={[styles.marker, styles.startMarker]} />
        </View>
      </MarkerView>

      {/* End marker */}
      {/* iOS CRASH FIX: Always render MarkerView to maintain stable child count */}
      <MarkerView coordinate={endPoint ? [endPoint.lng, endPoint.lat] : [0, 0]}>
        <View style={[styles.markerContainer, { opacity: endPoint ? 1 : 0 }]}>
          <View style={[styles.marker, styles.endMarker]} />
        </View>
      </MarkerView>
    </MapView>
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
                    onBearingChange={handleBearingChange}
                  />
                </Animated.View>
              </ComponentErrorBoundary>
            )}

            {/* 3D loading spinner */}
            {is3DMode && !is3DReady && (
              <View style={styles.loadingOverlay}>
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
            highlightedActivityId || highlightedTraceGeoJSON ? activityColor + '66' : activityColor
          }
          bounds={bounds || undefined}
          initialStyle={currentMapStyle}
          onClose={closeFullscreen}
        >
          {/* CRITICAL: Always render all ShapeSources to avoid iOS crash */}
          <SectionTrimLayer
            idPrefix="fullscreen"
            shadowGeoJSON={shadowGeoJSON}
            extensionGeoJSON={extensionGeoJSON}
            sectionGeoJSON={sectionGeoJSON}
            trimmedGeoJSON={trimmedGeoJSON}
            activityColor={activityColor}
            sectionOpacity={sectionOpacity}
            trimRange={trimRange}
            extensionTrack={extensionTrack}
            showExtensionAndSection={false}
            trimCasingWidth={6}
            trimLineWidth={5}
          />

          {/* Pre-loaded activity traces with filter */}
          <ShapeSource id="fullscreenAllTracesSource" shape={allTracesFeatureCollection}>
            <LineLayer
              id="fullscreenAllTracesLineCasing"
              filter={highlightedTraceFilter}
              style={{
                lineColor: '#FFFFFF',
                lineWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: hasAllTraces && highlightedTraceFilter ? 1 : 0,
              }}
            />
            <LineLayer
              id="fullscreenAllTracesLine"
              filter={highlightedTraceFilter}
              style={{
                lineColor: colors.chartCyan,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: hasAllTraces && highlightedTraceFilter ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* Highlighted lap points overlay */}
          <ShapeSource id="fullscreenHighlightedLapSource" shape={highlightedLapGeoJSON}>
            <LineLayer
              id="fullscreenHighlightedLapLineCasing"
              style={{
                lineColor: '#FFFFFF',
                lineOpacity: 1,
                lineWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="fullscreenHighlightedLapLine"
              style={{
                lineColor: colors.chartCyan,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>

          {/* Fallback: Highlighted activity trace */}
          <ShapeSource id="fullscreenHighlightedSource" shape={highlightedTraceGeoJSON}>
            <LineLayer
              id="fullscreenHighlightedLineCasing"
              style={{
                lineColor: '#FFFFFF',
                lineOpacity: 1,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="fullscreenHighlightedLine"
              style={{
                lineColor: colors.chartCyan,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>

          {/* Start marker */}
          {startPoint && (
            <MarkerView coordinate={[startPoint.lng, startPoint.lat]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.startMarker]} />
              </View>
            </MarkerView>
          )}

          {/* End marker */}
          {endPoint && (
            <MarkerView coordinate={[endPoint.lng, endPoint.lat]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.endMarker]} />
              </View>
            </MarkerView>
          )}
        </BaseMapView>
      </Modal>
    </>
  );
});
