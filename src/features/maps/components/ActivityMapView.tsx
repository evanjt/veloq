// Interactive GPS track map. Combines a MapLibre GL JS surface with a 3D
// terrain overlay, style switching, chart-scrub highlighting, and section
// creation. Layer descriptions live in activityMapLayerSpecs, the control stack
// in ActivityMapControls, and styles in ActivityMapView.styles.

import React, { useMemo, useState, useRef, useCallback, useEffect, memo } from 'react';
import { View, Modal, StatusBar, Animated, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { getActivityColor } from '@/features/activity/lib/activityUtils';
import { decodePolyline, LatLng } from '@/shared/geo/polyline';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import { colors } from '@/theme';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import { useSectionCreation } from '@/features/maps/hooks/useSectionCreation';
import { useMapCamera } from '@/features/maps/hooks/useMapCamera';
import { useMapLayers } from '@/features/maps/hooks/useMapLayers';
import { useMapFullscreen } from '@/features/maps/hooks/useMapFullscreen';
import { useThrottledValue } from '@/features/maps/hooks/useThrottledValue';
import { ComponentErrorBoundary } from '@/shared/ui';
import {
  featureCollection,
  lngLatFromLatLngPoint,
  pointFeature,
} from '@/features/maps/lib/coordinates';
import { HIGHLIGHT_THROTTLE_MS, REGION_SETTLE_DEBOUNCE_MS } from '@/features/maps/lib/mapBudgets';
import { TROPHY_ICON } from '@/features/maps/lib/mapIcons';
import type { ActivityType, ActivityStreams, RoutePoint } from '@/types';
import { BaseMapView } from './BaseMapView';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { TerrainUnavailableNotice } from './TerrainUnavailableNotice';
import { MapSurface, type MapCameraState, type MapPressEvent } from './MapSurface';
import {
  SectionCreationOverlay,
  type CreationState,
  type SectionCreationError,
} from './SectionCreationOverlay';
import { type MapStyleType, isDarkStyle, getNextStyle, MAP_ATTRIBUTIONS } from './mapStyles';
import { AttributionOverlay, type AttributionOverlayRef } from './AttributionOverlay';
import { ActivityMapControls } from './ActivityMapControls';
import {
  buildActivityLayers,
  buildActivitySources,
  buildFullscreenSectionLayers,
  buildFullscreenSectionSources,
  FULLSCREEN_SECTION_MARKER_LAYER_IDS,
  SECTION_MARKER_LAYER_IDS,
} from './activityMapLayerSpecs';
import { styles } from './ActivityMapView.styles';
const OVERLAY_IMAGES = [TROPHY_ICON];

/** The 2D layer, held transparent until the surface reports one way or the other. */
export const ACTIVITY_MAP_2D_LAYER_TEST_ID = 'activity-map-2d-layer';

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
  /** Measured height the attribution pill claims, so a parent drawing in the
   *  same corner can pad itself clear of however many rows it wraps to. */
  onAttributionClearanceChange?: (clearance: number) => void;
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
  onAttributionClearanceChange,
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
  const [terrainUnavailable, setTerrainUnavailable] = useState(false);
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
    surfaceRef,
    mapReady,
    mapFailed,
    bounds,
    currentCenterRef,
    currentZoomRef,
    bearingAnim,
    locationLoading,
    handleMapReady,
    handleMapFailed,
    handleRegionIsChanging,
    handleRegionDidChange: handleCameraRegionDidChange,
    resetOrientation,
    handleGetLocation,
  } = useMapCamera({
    validCoordinates,
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

  // The 3D layer is the only thing that can clear its own spinner, so a page
  // that cannot render drops back to the 2D map rather than spinning forever.
  // Same landing as the error boundary below.
  const handleMap3DFailed = useCallback(() => {
    setIs3DReady(false);
    setIs3DMode(false);
  }, []);

  // The page drew, it just had no DEM tiles, so the "3D" view is the flat map
  // with a wasted WebView on top of it. Same landing, plus a reason.
  const handleTerrainUnavailable = useCallback(() => {
    setIs3DReady(false);
    setIs3DMode(false);
    setTerrainUnavailable(true);
  }, []);

  // Handle 3D map ready
  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    Animated.timing(map3DOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [map3DOpacity]);

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

  // One tap path for both platforms: the page resolves the hit and tells us
  // whether a section marker was under the finger before we treat the tap as a
  // section-creation point.
  const handleSurfacePress = useCallback(
    ({ coordinate, feature }: MapPressEvent) => {
      const sectionId = feature?.properties?.sectionId;
      if (typeof sectionId === 'string') {
        onSectionMarkerPress?.(sectionId);
        return;
      }
      if (creationMode) {
        handleCreationTap(coordinate[0], coordinate[1]);
      }
    },
    [creationMode, handleCreationTap, onSectionMarkerPress]
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

  const isDark = isDarkStyle(mapStyle);

  const endpointsGeoJSON = useMemo(() => {
    const start = lngLatFromLatLngPoint(startPoint);
    const end = lngLatFromLatLngPoint(endPoint);
    return featureCollection([
      start ? pointFeature(start, { position: 'start' }) : null,
      end ? pointFeature(end, { position: 'end' }) : null,
    ]);
  }, [startPoint, endPoint]);

  const sectionCreationMarkers = useMemo(
    () =>
      featureCollection([
        sectionCreationStartCoord
          ? pointFeature(sectionCreationStartCoord, { position: 'start' })
          : null,
        sectionCreationEndCoord ? pointFeature(sectionCreationEndCoord, { position: 'end' }) : null,
      ]),
    [sectionCreationStartCoord, sectionCreationEndCoord]
  );

  // Scrub highlight moves at chart frame rate, so it is throttled to one frame
  // before it reaches the surface.
  const throttledHighlight = useThrottledValue(highlightGeoJSON, HIGHLIGHT_THROTTLE_MS);

  const layerInput = useMemo(
    () => ({
      routeGeoJSON,
      overlayGeoJSON,
      overlayHasData,
      consolidatedPortionsGeoJSON,
      sectionBoundariesGeoJSON,
      sectionMarkersGeoJSON,
      highlightGeoJSON: throttledHighlight,
      endpointsGeoJSON,
      sectionCreationLine: sectionGeoJSON,
      sectionCreationMarkers,
      activityColor,
      gradientActive,
      gradientLineExpression,
      hasSectionOverlays: !!sectionOverlaysGeoJSON,
      highlightedSectionId,
      hasHighlightPoint: !!highlightPoint,
      creationMode,
    }),
    [
      routeGeoJSON,
      overlayGeoJSON,
      overlayHasData,
      consolidatedPortionsGeoJSON,
      sectionBoundariesGeoJSON,
      sectionMarkersGeoJSON,
      throttledHighlight,
      endpointsGeoJSON,
      sectionGeoJSON,
      sectionCreationMarkers,
      activityColor,
      gradientActive,
      gradientLineExpression,
      sectionOverlaysGeoJSON,
      highlightedSectionId,
      highlightPoint,
      creationMode,
    ]
  );

  const sources = useMemo(() => buildActivitySources(layerInput), [layerInput]);
  const layers = useMemo(() => buildActivityLayers(layerInput), [layerInput]);

  const fullscreenSources = useMemo(
    () => buildFullscreenSectionSources(consolidatedPortionsGeoJSON, fullscreenPRMarkersGeoJSON),
    [consolidatedPortionsGeoJSON, fullscreenPRMarkersGeoJSON]
  );
  const fullscreenLayers = useMemo(
    () => buildFullscreenSectionLayers(!!sectionOverlaysGeoJSON),
    [sectionOverlaysGeoJSON]
  );

  const handleFullscreenPress = useCallback(
    ({ feature }: MapPressEvent) => {
      const sectionId = feature?.properties?.sectionId;
      if (typeof sectionId === 'string') onSectionMarkerPress?.(sectionId);
    },
    [onSectionMarkerPress]
  );

  // ----- Attribution management -----
  const attributionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    (state: MapCameraState) => {
      handleCameraRegionDidChange(state);

      // Debounce attribution update so it does not fight with map gestures
      if (attributionTimeoutRef.current) {
        clearTimeout(attributionTimeoutRef.current);
      }
      attributionTimeoutRef.current = setTimeout(() => {
        const newAttribution = computeAttributionFromRefs();
        // Update via ref to avoid parent re-render
        attributionRef.current?.setAttribution(newAttribution);
        onAttributionChangeRef.current?.(newAttribution);
      }, REGION_SETTLE_DEBOUNCE_MS);
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
      <View style={styles.container}>
        {/* 2D Map layer - hidden when 3D is ready */}
        <View
          style={[
            styles.mapLayer,
            is3DMode && is3DReady && styles.hiddenLayer,
            isFullscreen && styles.hiddenLayer,
          ]}
        >
          <View
            style={[styles.map, { opacity: mapReady || mapFailed ? 1 : 0 }]}
            testID={ACTIVITY_MAP_2D_LAYER_TEST_ID}
          >
            <MapSurface
              ref={surfaceRef}
              mapStyle={mapStyle}
              initialCamera={{ bounds: { sw: bounds.sw, ne: bounds.ne }, padding: 50 }}
              sources={sources}
              layers={layers}
              images={OVERLAY_IMAGES}
              interactiveLayers={SECTION_MARKER_LAYER_IDS}
              onMapReady={handleMapReady}
              onMapFailed={handleMapFailed}
              onPress={handleSurfacePress}
              onRegionIsChanging={handleRegionIsChanging}
              onRegionDidChange={handleRegionDidChange}
            />
          </View>
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
                onMapFailed={handleMap3DFailed}
                onTerrainUnavailable={handleTerrainUnavailable}
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
          <View style={styles.loadingOverlay} testID="activity-map-3d-loading">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}

        {terrainUnavailable && (
          <TerrainUnavailableNotice onDismiss={() => setTerrainUnavailable(false)} />
        )}

        {/* Attribution - uses ref-based updates to avoid map re-renders */}
        {(showAttribution || isFullscreen) && (
          <AttributionOverlay
            ref={attributionRef}
            initialAttribution={initialAttributionRef.current}
            onClearanceChange={onAttributionClearanceChange}
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
          overlaySources={fullscreenSources}
          overlayLayers={fullscreenLayers}
          overlayImages={OVERLAY_IMAGES}
          interactiveLayers={FULLSCREEN_SECTION_MARKER_LAYER_IDS}
          onPress={handleFullscreenPress}
        />
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
