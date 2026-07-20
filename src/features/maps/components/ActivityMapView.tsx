// Interactive GPS track map. Combines MapLibre 2D rendering with a 3D WebView
// overlay, style switching, chart-scrub highlighting, and section creation.
// Layer rendering lives in ActivityMapLayers, the control stack in
// ActivityMapControls, and styles in ActivityMapView.styles.

import React, { useMemo, useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  View,
  Pressable,
  Modal,
  StatusBar,
  Animated,
  Platform,
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

import { getActivityColor } from '@/features/activity/lib/activityUtils';
import { decodePolyline, LatLng } from '@/shared/geo/polyline';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import { colors, sectionPaletteExpression } from '@/theme';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import { useSectionCreation } from '@/features/maps/hooks/useSectionCreation';
import { useMapCamera } from '@/features/maps/hooks/useMapCamera';
import { useMapLayers } from '@/features/maps/hooks/useMapLayers';
import { useMapFullscreen } from '@/features/maps/hooks/useMapFullscreen';
import { useIOSMapTap } from '@/features/maps/hooks/useIOSMapTap';
import { ComponentErrorBoundary } from '@/shared/ui';
import type { ActivityType, ActivityStreams, RoutePoint } from '@/types';
import { BaseMapView } from './BaseMapView';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import {
  SectionCreationOverlay,
  type CreationState,
  type SectionCreationError,
} from './SectionCreationOverlay';
import {
  type MapStyleType,
  getMapStyle,
  isDarkStyle,
  getNextStyle,
  MAP_ATTRIBUTIONS,
} from './mapStyles';
import { AttributionOverlay, type AttributionOverlayRef } from './AttributionOverlay';
import { ActivityMapControls } from './ActivityMapControls';
import { ActivityMapLayers } from './ActivityMapLayers';
import { styles } from './ActivityMapView.styles';

/** Section overlay for map visualization */
export interface SectionOverlay {
  /** Unique section ID */
  id: string;
  /** Section's consensus polyline */
  sectionPolyline: LatLng[];
  /** Activity's trace portion that overlaps with this section */
  activityPortion?: LatLng[];
  /** Whether the current activity holds the PR for this section */
  isPR?: boolean;
}

// Re-export SectionCreationError for consumers
export type { SectionCreationError } from './SectionCreationOverlay';

/** Result of section creation */
export interface SectionCreationResult {
  /** GPS points for the section */
  polyline: RoutePoint[];
  /** Start index in activity coordinates */
  startIndex: number;
  /** End index in activity coordinates */
  endIndex: number;
  /** Distance in meters */
  distanceMeters: number;
}

interface ActivityMapViewProps {
  polyline?: string;
  coordinates?: LatLng[];
  activityType: ActivityType;
  /** Activity ID - used to resolve per-activity map style overrides */
  activityId?: string;
  height?: number;
  showStyleToggle?: boolean;
  /** Show map attribution (default: true) */
  showAttribution?: boolean;
  initialStyle?: MapStyleType;
  /** Index into coordinates array to highlight (from elevation chart) */
  highlightIndex?: number | null;
  /** Enable fullscreen on tap */
  enableFullscreen?: boolean;
  /** Called when 3D mode is toggled - parent can disable scroll */
  on3DModeChange?: (is3D: boolean) => void;
  /** Called when map style changes - parent can update attribution */
  onStyleChange?: (style: MapStyleType) => void;
  /** Called when attribution text changes (due to style or viewport change) */
  onAttributionChange?: (attribution: string) => void;
  /** Enable section creation mode */
  creationMode?: boolean;
  /** Current section creation state (parent-controlled) */
  creationState?: CreationState;
  /** Error details for section creation */
  creationError?: SectionCreationError | null;
  /** Called when a section is created */
  onSectionCreated?: (result: SectionCreationResult) => void;
  /** Called when section creation is cancelled */
  onCreationCancelled?: () => void;
  /** Called to dismiss error and retry */
  onCreationErrorDismiss?: () => void;
  /** Route overlay coordinates to show (e.g., matched route trace) */
  routeOverlay?: LatLng[] | null;
  /** Section overlays for sections tab - all matched sections with activity portions */
  sectionOverlays?: SectionOverlay[] | null;
  /** Active tab - controls section line color and legend visibility */
  activeTab?: string;
  /** Section ID to highlight (dims other sections when set) */
  highlightedSectionId?: string | null;
  /** Called when a section marker is tapped on the map */
  onSectionMarkerPress?: (sectionId: string) => void;
  /** Called when user exits 3D mode with a custom camera position */
  onCameraCapture?: (camera: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  }) => void;
  /** Saved camera override for 3D mode - restores a previously captured angle */
  initial3DCamera?: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  } | null;
  /** Activity country - used for demo mode satellite default on Swiss activities */
  country?: string | null;
  /** Activity streams - required to compute per-point gradient coloring */
  streams?: ActivityStreams | null;
}

export const ActivityMapView = memo(function ActivityMapView({
  polyline: encodedPolyline,
  coordinates: providedCoordinates,
  activityType,
  activityId,
  height = 300,
  showStyleToggle = false,
  showAttribution = true,
  initialStyle,
  highlightIndex,
  enableFullscreen = false,
  on3DModeChange,
  onStyleChange,
  onAttributionChange,
  creationMode = false,
  creationState: externalCreationState,
  creationError,
  onSectionCreated,
  onCreationCancelled,
  onCreationErrorDismiss,
  routeOverlay,
  sectionOverlays,
  activeTab,
  highlightedSectionId,
  onSectionMarkerPress,
  onCameraCapture,
  initial3DCamera,
  country,
  streams,
}: ActivityMapViewProps) {
  const { getStyleForActivity } = useMapPreferences();
  const preferredStyle = getStyleForActivity(activityType, activityId, country);
  const [mapStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? preferredStyle);
  const { isFullscreen, openFullscreen, closeFullscreen } = useMapFullscreen({ enableFullscreen });
  const [is3DMode, setIs3DMode] = useState(!!initial3DCamera);
  const [is3DReady, setIs3DReady] = useState(false);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const map3DOpacity = useRef(new Animated.Value(0)).current;

  // Track the latest 3D camera state for capture on exit
  const camera3DRef = useRef<{
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  } | null>(null);
  const prev3DModeRef = useRef(false);

  // Track if user manually overrode the style
  const [userOverride, setUserOverride] = useState(false);

  // Parse and validate coordinates early so they're available for callbacks
  const coordinates = useMemo(() => {
    if (providedCoordinates && providedCoordinates.length > 0) {
      return providedCoordinates;
    }
    if (encodedPolyline) {
      return decodePolyline(encodedPolyline);
    }
    return [];
  }, [encodedPolyline, providedCoordinates]);

  // Filter valid coordinates for bounds and route display
  const validCoordinates = useMemo(() => {
    return coordinates.filter((c) => !isNaN(c.latitude) && !isNaN(c.longitude));
  }, [coordinates]);

  // ----- Camera management (position, bounds, ready state, bearing, location) -----
  const {
    cameraRef,
    mapRef,
    mapReady,
    mapKey,
    bounds,
    currentCenterRef,
    currentZoomRef,
    bearingAnim,
    locationLoading,
    handleMapFinishLoading,
    handleMapLoadError,
    handleRegionIsChanging,
    handleRegionDidChange: handleCameraRegionDidChange,
    resetOrientation,
    handleGetLocation,
  } = useMapCamera({
    validCoordinates,
    mapStyle,
    is3DMode,
    is3DReady,
    map3DRef,
  });

  // ----- Layer GeoJSON preparation -----
  const {
    routeGeoJSON,
    overlayGeoJSON,
    overlayHasData,
    sectionOverlaysGeoJSON,
    consolidatedPortionsGeoJSON,
    sectionBoundariesGeoJSON,
    sectionMarkersGeoJSON,
    sectionNumberedMarkersGeoJSON,
    sectionPRMarkersGeoJSON,
    fullscreenPRMarkersGeoJSON,
    routeCoords,
    highlightPoint,
    highlightGeoJSON,
    gradientLineExpression,
  } = useMapLayers({
    validCoordinates,
    coordinates,
    routeOverlay,
    sectionOverlays,
    highlightIndex,
    activeTab,
    streams,
  });

  // "Color by gradient" toggle - session-local, per-activity.
  // Off by default so the normal solid-color experience is unchanged.
  const [colorByGradient, setColorByGradient] = useState(false);
  const hasGradientData = gradientLineExpression != null;
  const gradientActive = colorByGradient && hasGradientData;

  const toggleColorByGradient = useCallback(() => {
    setColorByGradient((current) => !current);
  }, []);

  // Section creation hook
  const {
    creationState,
    startIndex,
    endIndex,
    sectionDistance,
    sectionPointCount,
    sectionGeoJSON,
    sectionStartPoint,
    sectionEndPoint,
    handleCreationTap,
    handleCreationConfirm,
    handleCreationCancel,
    handleCreationReset,
  } = useSectionCreation({
    creationMode,
    externalCreationState,
    validCoordinates,
    onSectionCreated,
    onCreationCancelled,
  });

  // Update map style when preference changes (unless user manually toggled)
  useEffect(() => {
    if (!userOverride && !initialStyle && mapStyle !== preferredStyle) {
      setMapStyle(preferredStyle);
    }
  }, [userOverride, initialStyle, mapStyle, preferredStyle]);

  const toggleMapStyle = useCallback(() => {
    setUserOverride(true);
    setMapStyle((current) => getNextStyle(current));
  }, []);

  // Toggle 3D mode
  const toggle3D = useCallback(() => {
    setIs3DMode((current) => !current);
  }, []);

  // Notify parent when 3D mode changes (outside of render cycle)
  // Also fire onCameraCapture when exiting 3D mode with a saved camera
  // Skip initial mount - only user-initiated toggles should save overrides
  const modeInitRef = useRef(true);
  useEffect(() => {
    if (modeInitRef.current) {
      modeInitRef.current = false;
      prev3DModeRef.current = is3DMode;
      return;
    }
    if (prev3DModeRef.current && !is3DMode && camera3DRef.current) {
      onCameraCapture?.(camera3DRef.current);
    }
    prev3DModeRef.current = is3DMode;
    on3DModeChange?.(is3DMode);
  }, [is3DMode, on3DModeChange, onCameraCapture]);

  // Notify parent when map style changes (skip initial mount - only user-initiated changes)
  const styleInitRef = useRef(true);
  useEffect(() => {
    if (styleInitRef.current) {
      styleInitRef.current = false;
      return;
    }
    onStyleChange?.(mapStyle);
  }, [mapStyle, onStyleChange]);

  // Reset 3D ready state when toggling off
  useEffect(() => {
    if (!is3DMode) {
      setIs3DReady(false);
      map3DOpacity.setValue(0);
    }
  }, [is3DMode, map3DOpacity]);

  // Refs used by the attribution pipeline - declared here so the 3D camera
  // handler below can mirror camera state into them without TDZ issues.
  const attributionRef = useRef<AttributionOverlayRef>(null);
  const initialAttributionRef = useRef(MAP_ATTRIBUTIONS[mapStyle]);
  const mapStyleRef = useRef(mapStyle);
  const is3DModeRef = useRef(is3DMode);
  const onAttributionChangeRef = useRef(onAttributionChange);
  mapStyleRef.current = mapStyle;
  is3DModeRef.current = is3DMode;
  onAttributionChangeRef.current = onAttributionChange;

  // Track 3D camera state for capture on exit, and mirror into the shared
  // center/zoom refs so the attribution pipeline reflects the 3D viewport.
  const handleCameraStateChange = useCallback(
    (camera: { center: [number, number]; zoom: number; bearing: number; pitch: number }) => {
      camera3DRef.current = camera;
      if (is3DModeRef.current) {
        currentCenterRef.current = camera.center;
        currentZoomRef.current = camera.zoom;
        const newAttribution = computeAttribution({
          style: mapStyleRef.current,
          is3D: true,
          center: camera.center,
          zoom: camera.zoom,
        });
        attributionRef.current?.setAttribution(newAttribution);
        onAttributionChangeRef.current?.(newAttribution);
      }
    },
    [currentCenterRef, currentZoomRef]
  );

  // Handle 3D map ready
  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    Animated.timing(map3DOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [map3DOpacity]);

  // Handle native map press - only used for section creation on Android.
  // Fullscreen is handled by the cross-platform touch handler.
  const handleMapPress = useCallback(
    (feature: GeoJSON.Feature) => {
      // In creation mode, delegate to section creation hook
      if (creationMode && feature?.geometry?.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        handleCreationTap(lng, lat);
      }
    },
    [creationMode, handleCreationTap]
  );

  // iOS tap handler - converts screen coordinates to map coordinates
  // MapView.onPress doesn't fire reliably on iOS with Fabric architecture
  const { onTouchStart: onIOSTouchStart, onTouchEnd: onIOSTouchEnd } = useIOSMapTap({
    mapRef,
    onMapPress: handleMapPress,
  });

  // Stop in-flight animations on unmount to prevent updates on unmounted component
  useEffect(() => {
    return () => {
      map3DOpacity.stopAnimation();
    };
  }, [map3DOpacity]);

  // Handle 3D map bearing changes (for compass sync)
  const handleBearingChange = useCallback(
    (bearing: number) => {
      bearingAnim.setValue(-bearing);
    },
    [bearingAnim]
  );

  // Handle 3D map click - forward to section creation hook
  const handle3DMapClick = useCallback(
    (coordinate: [number, number]) => {
      if (creationMode) {
        handleCreationTap(coordinate[0], coordinate[1]);
      }
    },
    [creationMode, handleCreationTap]
  );

  // Handle 3D section click - forward to parent handler
  const handle3DSectionClick = useCallback(
    (sectionId: string) => {
      onSectionMarkerPress?.(sectionId);
    },
    [onSectionMarkerPress]
  );

  // Section creation start/end coordinates in [lng, lat] format for 3D map
  const sectionCreationStartCoord: [number, number] | null = useMemo(
    () =>
      creationMode && sectionStartPoint
        ? [sectionStartPoint.longitude, sectionStartPoint.latitude]
        : null,
    [creationMode, sectionStartPoint]
  );
  const sectionCreationEndCoord: [number, number] | null = useMemo(
    () =>
      creationMode && sectionEndPoint
        ? [sectionEndPoint.longitude, sectionEndPoint.latitude]
        : null,
    [creationMode, sectionEndPoint]
  );

  const activityColor = getActivityColor(activityType);
  const startPoint = validCoordinates[0];
  const endPoint = validCoordinates[validCoordinates.length - 1];

  const mapStyleValue = getMapStyle(mapStyle);
  const isDark = isDarkStyle(mapStyle);

  // ----- Attribution management -----
  const attributionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // attributionRef / initialAttributionRef / mapStyleRef / is3DModeRef /
  // onAttributionChangeRef are declared earlier (before handleCameraStateChange)
  // so the 3D camera handler can mirror camera state into them without TDZ.

  // Compute attribution from current viewport - uses refs for latest values
  const computeAttributionFromRefs = useCallback(
    () =>
      computeAttribution({
        style: mapStyleRef.current,
        is3D: is3DModeRef.current,
        center: currentCenterRef.current,
        zoom: currentZoomRef.current,
      }),
    [currentCenterRef, currentZoomRef]
  );

  // Compose camera region-did-change with attribution debounce
  const handleRegionDidChange = useCallback(
    (feature: GeoJSON.Feature) => {
      // Delegate viewport tracking to camera hook
      handleCameraRegionDidChange(feature);

      // Debounce attribution update to avoid interfering with map gestures
      if (attributionTimeoutRef.current) {
        clearTimeout(attributionTimeoutRef.current);
      }
      attributionTimeoutRef.current = setTimeout(() => {
        // Use refs to get latest values (avoids stale closure)
        const newAttribution = computeAttributionFromRefs();
        // Update via ref to avoid parent re-render
        attributionRef.current?.setAttribution(newAttribution);
        onAttributionChangeRef.current?.(newAttribution);
      }, 300);
    },
    [handleCameraRegionDidChange, computeAttributionFromRefs]
  );

  // Update attribution when mapStyle or is3DMode changes (immediate, not debounced)
  // Cancel any pending debounced update to avoid flicker
  useEffect(() => {
    if (attributionTimeoutRef.current) {
      clearTimeout(attributionTimeoutRef.current);
      attributionTimeoutRef.current = null;
    }
    const newAttribution = computeAttributionFromRefs();
    // Update via ref to avoid parent re-render
    attributionRef.current?.setAttribution(newAttribution);
    onAttributionChange?.(newAttribution);
  }, [mapStyle, is3DMode, computeAttributionFromRefs, onAttributionChange]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (attributionTimeoutRef.current) {
        clearTimeout(attributionTimeoutRef.current);
      }
    };
  }, []);

  if (!bounds || validCoordinates.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <MaterialCommunityIcons name="map-marker-off" size={48} color={colors.textSecondary} />
      </View>
    );
  }

  const hasRoute = routeCoords.length > 0;

  return (
    <View style={[styles.outerContainer, { height }]}>
      <View
        style={styles.container}
        {...(creationMode && Platform.OS === 'ios'
          ? {
              onTouchStart: onIOSTouchStart,
              onTouchEnd: (e: { nativeEvent: { locationX: number; locationY: number } }) =>
                onIOSTouchEnd(e, () => !isFullscreen && !(is3DMode && is3DReady)),
            }
          : {})}
      >
        {/* 2D Map layer - hidden when 3D is ready */}
        <View
          style={[
            styles.mapLayer,
            is3DMode && is3DReady && styles.hiddenLayer,
            isFullscreen && styles.hiddenLayer,
          ]}
        >
          <MapView
            ref={mapRef}
            key={`activity-map-${mapKey}`}
            style={[styles.map, { opacity: mapReady ? 1 : 0 }]}
            mapStyle={mapStyleValue}
            logoEnabled={false}
            attributionEnabled={false}
            compassEnabled={false}
            scrollEnabled={true}
            zoomEnabled={true}
            rotateEnabled={true}
            pitchEnabled={false}
            onRegionIsChanging={handleRegionIsChanging}
            onRegionDidChange={handleRegionDidChange}
            onPress={Platform.OS === 'android' ? handleMapPress : undefined}
            onDidFailLoadingMap={handleMapLoadError}
            onDidFinishLoadingMap={handleMapFinishLoading}
          >
            {/* Camera with ref for programmatic control */}
            {/* CRITICAL: Provide stable position props to prevent MapLibre from resetting */}
            {/* When Camera has no position, MapLibre may default to fitting bounds on re-render */}
            {/* We track position in refs and feed it back to keep camera stable */}
            <Camera
              ref={cameraRef}
              centerCoordinate={currentCenterRef.current ?? undefined}
              zoomLevel={currentZoomRef.current}
              animationDuration={0}
              animationMode="moveTo"
              followUserLocation={false}
            />

            <ActivityMapLayers
              overlayGeoJSON={overlayGeoJSON}
              overlayHasData={overlayHasData}
              routeGeoJSON={routeGeoJSON}
              activityColor={activityColor}
              gradientActive={gradientActive}
              gradientLineExpression={gradientLineExpression}
              consolidatedPortionsGeoJSON={consolidatedPortionsGeoJSON}
              sectionBoundariesGeoJSON={sectionBoundariesGeoJSON}
              sectionOverlaysGeoJSON={sectionOverlaysGeoJSON}
              sectionNumberedMarkersGeoJSON={sectionNumberedMarkersGeoJSON}
              sectionPRMarkersGeoJSON={sectionPRMarkersGeoJSON}
              highlightGeoJSON={highlightGeoJSON}
              highlightPoint={highlightPoint}
              highlightedSectionId={highlightedSectionId}
              startPoint={startPoint}
              endPoint={endPoint}
              sectionGeoJSON={sectionGeoJSON}
              sectionStartPoint={sectionStartPoint}
              sectionEndPoint={sectionEndPoint}
              startIndex={startIndex}
              endIndex={endIndex}
              creationMode={creationMode}
              onSectionMarkerPress={onSectionMarkerPress}
            />
          </MapView>
        </View>

        {/* 3D Map layer */}
        {/* Error boundary prevents a 3D crash from taking out the entire map */}
        {is3DMode && hasRoute && !isFullscreen && (
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
                coordinates={routeCoords}
                mapStyle={mapStyle}
                routeColor={activityColor}
                highlightCoordinate={
                  highlightPoint ? [highlightPoint.longitude, highlightPoint.latitude] : null
                }
                tracesGeoJSON={
                  consolidatedPortionsGeoJSON.features.length > 0
                    ? consolidatedPortionsGeoJSON
                    : undefined
                }
                sectionBoundariesGeoJSON={
                  sectionBoundariesGeoJSON.features.length > 0
                    ? sectionBoundariesGeoJSON
                    : undefined
                }
                highlightedSectionId={highlightedSectionId}
                sectionMarkersGeoJSON={
                  sectionMarkersGeoJSON.features.length > 0 ? sectionMarkersGeoJSON : undefined
                }
                onMapReady={handleMap3DReady}
                onBearingChange={handleBearingChange}
                onCameraStateChange={handleCameraStateChange}
                initialCamera={initial3DCamera}
                onMapClick={handle3DMapClick}
                onSectionClick={handle3DSectionClick}
                sectionCreationGeoJSON={creationMode ? sectionGeoJSON : null}
                sectionCreationStart={sectionCreationStartCoord}
                sectionCreationEnd={sectionCreationEndCoord}
              />
            </Animated.View>
          </ComponentErrorBoundary>
        )}

        {/* 3D loading spinner */}
        {is3DMode && !is3DReady && !isFullscreen && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}

        {/* Attribution - uses ref-based updates to avoid map re-renders */}
        {(showAttribution || isFullscreen) && (
          <AttributionOverlay
            ref={attributionRef}
            initialAttribution={initialAttributionRef.current}
          />
        )}
      </View>

      {/* Control buttons - rendered OUTSIDE map container for reliable touch handling */}
      {showStyleToggle && !isFullscreen && (
        <ActivityMapControls
          isDark={isDark}
          mapStyle={mapStyle}
          onToggleStyle={toggleMapStyle}
          hasGradientData={hasGradientData}
          gradientActive={gradientActive}
          onToggleGradient={toggleColorByGradient}
          is3DMode={is3DMode}
          hasRoute={hasRoute}
          onToggle3D={toggle3D}
          bearingAnim={bearingAnim}
          onResetOrientation={resetOrientation}
          locationLoading={locationLoading}
          onGetLocation={handleGetLocation}
          enableFullscreen={enableFullscreen}
          onOpenFullscreen={openFullscreen}
        />
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
          routeCoordinates={routeCoords}
          routeColor={activityColor}
          bounds={bounds}
          initialStyle={mapStyle}
          onClose={closeFullscreen}
        >
          {/* Section portion overlays in fullscreen - one line per section, drawn along
              the activity's own GPS trace with white casing for contrast. */}
          {/* CRITICAL: Always render stable ShapeSource to avoid Fabric crash */}
          <ShapeSource id="fs-portion-overlays-consolidated" shape={consolidatedPortionsGeoJSON}>
            <LineLayer
              id="fs-portion-overlays-casing"
              style={{
                lineColor: '#FFFFFF',
                lineWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: sectionOverlaysGeoJSON ? 0.9 : 0,
              }}
            />
            <LineLayer
              id="fs-portion-overlays-line"
              style={{
                lineColor: [
                  'case',
                  ['==', ['get', 'isPR'], true],
                  '#D4AF37',
                  sectionPaletteExpression() as unknown as string,
                ],
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: sectionOverlaysGeoJSON ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* PR markers at center of each PR section in fullscreen.
              Vector trophy via MarkerView for visual parity with feed cards. */}
          {fullscreenPRMarkersGeoJSON.features.map((f) => {
            const geom = f.geometry as GeoJSON.Point;
            const coord = geom?.coordinates as [number, number] | undefined;
            const sectionId = f.properties?.sectionId as string | undefined;
            if (!coord || !sectionId) return null;
            return (
              <MarkerView key={`fs-pr-${sectionId}`} coordinate={coord} allowOverlap={true}>
                <Pressable
                  onPress={() => onSectionMarkerPress?.(sectionId)}
                  style={styles.prTrophyBadge}
                >
                  <MaterialCommunityIcons name="trophy" size={12} color="#FFFFFF" />
                </Pressable>
              </MarkerView>
            );
          })}

          {/* Start marker */}
          {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
          <MarkerView
            coordinate={startPoint ? [startPoint.longitude, startPoint.latitude] : [0, 0]}
          >
            <View style={[styles.markerContainer, { opacity: startPoint ? 1 : 0 }]}>
              <View style={[styles.marker, styles.startMarker]} />
            </View>
          </MarkerView>

          {/* End marker */}
          {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
          <MarkerView coordinate={endPoint ? [endPoint.longitude, endPoint.latitude] : [0, 0]}>
            <View style={[styles.markerContainer, { opacity: endPoint ? 1 : 0 }]}>
              <View style={[styles.marker, styles.endMarker]} />
            </View>
          </MarkerView>
        </BaseMapView>
      </Modal>

      {/* Section creation overlay */}
      {creationMode && (
        <SectionCreationOverlay
          state={externalCreationState ?? creationState}
          startIndex={startIndex}
          endIndex={endIndex}
          coordinateCount={validCoordinates.length}
          sectionDistance={sectionDistance}
          sectionPointCount={sectionPointCount}
          error={creationError}
          onConfirm={handleCreationConfirm}
          onCancel={handleCreationCancel}
          onReset={handleCreationReset}
          onDismissError={onCreationErrorDismiss}
        />
      )}
    </View>
  );
});
