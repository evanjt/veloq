/**
 * @fileoverview ActivityMapView - Interactive GPS track visualization
 *
 * **Overview**
 *
 * This component renders activity GPS tracks on a map with support for multiple
 * visualization modes, style switching, and interactive features. It combines
 * MapLibre's 2D rendering with a 3D WebView overlay for terrain visualization.
 *
 * **Architecture**
 *
 * **Dual Rendering System:**
 * - 2D Map: MapLibre React Native (native performance, gesture handling)
 * - 3D Map: WebView with Mapbox GL JS (terrain visualization)
 * - Crossfading: Animated opacity transitions between modes
 *
 * **State Management:**
 * - mapStyle: Current map style (standard/satellite/terrain)
 * - userOverride: Whether user manually changed style (prevents auto-switching)
 * - is3DMode/is3DReady: 3D mode state with loading indicator
 * - creationState/startIndex/endIndex: Section creation flow
 * - highlightIndex: Elevation chart crosshair position
 *
 * **Data Flow:**
 * 1. Props (polyline/coordinates) → decoded → validated → rendered
 * 2. Map style preference → auto-applied (unless user override)
 * 3. Section creation → start → end → callback with result
 * 4. Highlight index → marker → camera follow (optional)
 *
 * **Key Features:**
 *
 * **Style Switching:**
 * - Cycles: standard → satellite → terrain → standard
 * - Respects user preferences from MapPreferencesContext
 * - Manual override persists until component remounts
 *
 * **Section Creation:**
 * - Two-tap interaction: select start → select end → confirm
 * - Distance calculation via Haversine formula
 * - Visual feedback with marker overlays
 * - Callback with polyline slice and distance
 *
 * **Location Services:**
 * - Requests foreground permissions on demand
 * - Camera animates to user position
 * - Silently fails if permission denied
 *
 * **Performance Optimizations:**
 * - coordinate parsing memoized (expensive decodePolyline)
 * - Valid coordinates filtered once (NaN checks)
 * - 3D WebView opacity animated (native driver)
 *
 * **Sub-hooks:**
 * - useMapCamera: Camera position, bounds, ready state, bearing, location
 * - useMapLayers: GeoJSON data preparation for all map layers
 * - useSectionCreation: Section creation state machine
 *
 * @example
 * ```tsx
 * // Basic usage with polyline
 * <ActivityMapView
 *   polyline={activity.map.polyline}
 *   activityType={activity.type}
 *   height={400}
 * />
 *
 * // With section creation
 * <ActivityMapView
 *   polyline={activity.map.polyline}
 *   activityType={activity.type}
 *   creationMode={isEditing}
 *   onSectionCreated={(result) => {
 *     console.log('Section:', result.distanceMeters, 'm');
 *   }}
 *   onCreationCancelled={() => {
 *     setIsEditing(false);
 *   }}
 * />
 *
 * // With elevation highlight
 * <ActivityMapView
 *   polyline={activity.map.polyline}
 *   activityType={activity.type}
 *   highlightIndex={chartPointIndex}
 * />
 * ```
 */

import React, { useMemo, useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Text as RNText,
  Modal,
  StatusBar,
  Animated,
  Platform,
  ActivityIndicator,
  type NativeSyntheticEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Map as MLMap,
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
  type ViewStateChangeEvent,
  type PressEvent,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';
import { toLngLatBounds, toViewPadding } from '@/lib/maps/bounds';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { decodePolyline, LatLng, getActivityColor } from '@/lib';
import { computeAttribution } from '@/lib/maps/computeAttribution';
import {
  brand,
  colors,
  darkColors,
  spacing,
  layout,
  shadows,
  sectionPalette,
  sectionPaletteExpression,
  sectionPaletteIndex,
} from '@/theme';
import { useMapPreferences } from '@/providers';
import { useSectionCreation } from '@/hooks/maps/useSectionCreation';
import { useMapCamera } from '@/hooks/maps/useMapCamera';
import { useMapLayers } from '@/hooks/maps/useMapLayers';
import { useMapFullscreen } from '@/hooks/maps/useMapFullscreen';
import { useIOSMapTap } from '@/hooks/maps/useIOSMapTap';
import { BaseMapView } from './BaseMapView';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { CompassArrow, ComponentErrorBoundary } from '@/components/ui';
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
  getStyleIcon,
  MAP_ATTRIBUTIONS,
} from './mapStyles';
import { AttributionOverlay, type AttributionOverlayRef } from './AttributionOverlay';
import type { ActivityType, ActivityStreams, RoutePoint } from '@/types';

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
  /** Activity ID — used to resolve per-activity map style overrides */
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
  /** Saved camera override for 3D mode — restores a previously captured angle */
  initial3DCamera?: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  } | null;
  /** Activity country — used for demo mode satellite default on Swiss activities */
  country?: string | null;
  /** Activity streams — required to compute per-point gradient coloring */
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
  const { t } = useTranslation();
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

  // DEBUG: Track render count
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

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
    boundsCenter,
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
    routeHasData,
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

  // "Color by gradient" toggle — session-local, per-activity.
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
    sectionHasData,
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
  // Skip initial mount — only user-initiated toggles should save overrides
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

  // Notify parent when map style changes (skip initial mount — only user-initiated changes)
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

  // Refs used by the attribution pipeline — declared here so the 3D camera
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

  // Handle map press - using MapView's native onPress instead of gesture detector
  // This properly distinguishes taps from zoom/pan gestures
  // Handle native map press - only used for section creation on Android
  // Fullscreen is handled by the cross-platform touch handler above
  const handleMapPress = useCallback(
    (event: NativeSyntheticEvent<PressEvent> | NativeSyntheticEvent<PressEventWithFeatures>) => {
      if (__DEV__) {
        console.log('[ActivityMapView:Camera] handleMapPress', {
          creationMode,
          creationState,
        });
      }
      // In creation mode, delegate to section creation hook
      if (creationMode) {
        const lngLat = event.nativeEvent.lngLat;
        if (lngLat) {
          handleCreationTap(lngLat[0], lngLat[1]);
        }
      }
    },
    [creationMode, creationState, handleCreationTap]
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

  // Handle 3D map click — forward to section creation hook
  const handle3DMapClick = useCallback(
    (coordinate: [number, number]) => {
      if (creationMode) {
        handleCreationTap(coordinate[0], coordinate[1]);
      }
    },
    [creationMode, handleCreationTap]
  );

  // Handle 3D section click — forward to parent handler
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

  // DEBUG: Log camera ref values
  if (__DEV__) {
    console.log('[ActivityMapView:Camera] Camera ref values', {
      center: currentCenterRef.current,
      zoom: currentZoomRef.current,
      boundsCenter,
    });
  }

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
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      // Delegate viewport tracking to camera hook
      handleCameraRegionDidChange(event);

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

  // DEBUG: Log render with key state
  if (__DEV__) {
    console.log('[ActivityMapView] RENDER #' + renderCountRef.current, {
      mapReady,
      creationMode,
      creationState,
      startIndex,
      endIndex,
      mapKey,
      mapStyle,
      coordCount: validCoordinates.length,
    });
  }

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
          <MLMap
            ref={mapRef}
            key={`activity-map-${mapKey}`}
            style={[styles.map, { opacity: mapReady ? 1 : 0 }]}
            mapStyle={mapStyleValue}
            logo={false}
            attribution={false}
            compass={false}
            dragPan={true}
            touchZoom={true}
            touchRotate={true}
            touchPitch={false}
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
              center={currentCenterRef.current ?? undefined}
              zoom={currentZoomRef.current}
              duration={0}
            />

            {/* Route overlay (matched route trace) - rendered first so activity line is on top */}
            {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
            {/* When no data, overlayGeoJSON is an empty FeatureCollection, not null */}
            <GeoJSONSource id="overlaySource" data={overlayGeoJSON}>
              <Layer
                type="line"
                id="overlayLine"
                style={{
                  lineColor: '#00E5FF',
                  lineWidth: 5,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineOpacity: 0.5,
                }}
              />
            </GeoJSONSource>

            {/* Route line - render first so section overlays appear on top */}
            {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
            <GeoJSONSource id="routeSource" data={routeGeoJSON}>
              <Layer
                type="line"
                id="routeLineCasing"
                style={{
                  lineColor: '#FFFFFF',
                  lineWidth: 5,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineOpacity: sectionOverlaysGeoJSON
                    ? highlightedSectionId
                      ? 0.25
                      : 0.8
                    : overlayHasData
                      ? 0.85
                      : 1,
                }}
              />
              <Layer
                type="line"
                id="routeLine"
                style={{
                  lineColor: activityColor,
                  lineWidth: 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                  // Hide the solid-color line when gradient coloring is active.
                  lineOpacity: gradientActive
                    ? 0
                    : sectionOverlaysGeoJSON
                      ? highlightedSectionId
                        ? 0.25
                        : 0.8
                      : overlayHasData
                        ? 0.85
                        : 1,
                }}
              />
            </GeoJSONSource>

            {/* Gradient-coloured route line (requires lineMetrics for line-progress). */}
            {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
            <GeoJSONSource id="routeGradientSource" data={routeGeoJSON} lineMetrics={true}>
              <Layer
                type="line"
                id="routeLineGradient"
                style={{
                  lineColor: activityColor,
                  lineWidth: 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                  ...(gradientActive && gradientLineExpression
                    ? { lineGradient: gradientLineExpression as unknown as string }
                    : {}),
                  lineOpacity: gradientActive ? 1 : 0,
                }}
              />
            </GeoJSONSource>

            {/* Section portion overlays - render after route line so they appear on top.
                One line per section, drawn along the activity's own GPS trace (not the
                averaged section consensus). White casing for contrast, PR gold or section
                palette color for fill. */}
            {/* CRITICAL: Always render stable ShapeSource to avoid Fabric crash */}
            <GeoJSONSource id="portion-overlays-consolidated" data={consolidatedPortionsGeoJSON}>
              <Layer
                type="line"
                id="portion-overlays-casing"
                style={{
                  lineColor: '#FFFFFF',
                  lineWidth: highlightedSectionId
                    ? ['case', ['==', ['get', 'id'], highlightedSectionId], 7, 5]
                    : 6,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineOpacity: sectionOverlaysGeoJSON
                    ? highlightedSectionId
                      ? ['case', ['==', ['get', 'id'], highlightedSectionId], 1, 0.15]
                      : 0.9
                    : 0,
                }}
              />
              <Layer
                type="line"
                id="portion-overlays-line"
                style={{
                  lineColor: highlightedSectionId
                    ? [
                        'case',
                        ['==', ['get', 'id'], highlightedSectionId],
                        '#00E5FF',
                        [
                          'case',
                          ['==', ['get', 'isPR'], true],
                          '#D4AF37',
                          sectionPaletteExpression() as unknown as string,
                        ],
                      ]
                    : [
                        'case',
                        ['==', ['get', 'isPR'], true],
                        '#D4AF37',
                        sectionPaletteExpression() as unknown as string,
                      ],
                  lineWidth: highlightedSectionId
                    ? ['case', ['==', ['get', 'id'], highlightedSectionId], 5, 3]
                    : 4,
                  lineCap: 'butt',
                  lineJoin: 'round',
                  // Dashed pattern so overlapping sections are visually
                  // distinguishable (you can see the other color showing through the gaps).
                  lineDasharray: [2, 1.2],
                  lineOpacity: sectionOverlaysGeoJSON
                    ? highlightedSectionId
                      ? ['case', ['==', ['get', 'id'], highlightedSectionId], 1, 0.25]
                      : 0.95
                    : 0,
                }}
              />
            </GeoJSONSource>

            {/* Section boundary ticks — perpendicular short line segments at each
                portion's start/end. Always rendered, drawn above portions so section
                breaks are visible even where portions overlap. */}
            <GeoJSONSource id="section-boundaries" data={sectionBoundariesGeoJSON}>
              <Layer
                type="line"
                id="section-boundaries-casing"
                style={{
                  lineColor: '#000000',
                  lineWidth: 6,
                  lineCap: 'round',
                  lineOpacity: 0.45,
                }}
              />
              <Layer
                type="line"
                id="section-boundaries-line"
                style={{
                  lineColor: '#FFFFFF',
                  lineWidth: 3.5,
                  lineCap: 'round',
                  lineOpacity: 1,
                }}
              />
            </GeoJSONSource>

            {/* Start marker */}
            {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
            <Marker
              id="activity-start"
              lngLat={startPoint ? [startPoint.longitude, startPoint.latitude] : [0, 0]}
            >
              <View style={[styles.markerContainer, { opacity: startPoint ? 1 : 0 }]}>
                <View style={[styles.marker, styles.startMarker]} />
              </View>
            </Marker>

            {/* End marker */}
            {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
            <Marker
              id="activity-end"
              lngLat={endPoint ? [endPoint.longitude, endPoint.latitude] : [0, 0]}
            >
              <View style={[styles.markerContainer, { opacity: endPoint ? 1 : 0 }]}>
                <View style={[styles.marker, styles.endMarker]} />
              </View>
            </Marker>

            {/* Section creation: selected section line */}
            {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
            <GeoJSONSource id="sectionSource" data={sectionGeoJSON}>
              <Layer
                type="line"
                id="sectionLine"
                style={{
                  lineColor: colors.success,
                  lineWidth: 6,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </GeoJSONSource>

            {/* Section creation: start marker */}
            {/* CRITICAL: Always render to avoid camera reset when marker appears */}
            {/* Use activity start as fallback to stay within map bounds (not [0,0]) */}
            {/* Key includes startIndex to force position update (stable when null) */}
            <Marker
              key={`section-start-${startIndex ?? 'none'}`}
              id={`section-start-marker-${startIndex ?? 'none'}`}
              lngLat={
                sectionStartPoint
                  ? [sectionStartPoint.longitude, sectionStartPoint.latitude]
                  : startPoint
                    ? [startPoint.longitude, startPoint.latitude]
                    : [0, 0]
              }
            >
              <View
                style={[
                  styles.markerContainer,
                  { opacity: creationMode && sectionStartPoint ? 1 : 0 },
                ]}
              >
                <View style={[styles.sectionCreationMarker, styles.sectionStartMarker]}>
                  <MaterialCommunityIcons name="flag-outline" size={16} color={colors.textOnDark} />
                </View>
              </View>
            </Marker>

            {/* Section creation: end marker */}
            {/* CRITICAL: Always render to avoid camera reset when marker appears */}
            {/* Use activity end as fallback to stay within map bounds (not [0,0]) */}
            {/* Key includes endIndex to force position update (stable when null) */}
            <Marker
              key={`section-end-${endIndex ?? 'none'}`}
              id={`section-end-marker-${endIndex ?? 'none'}`}
              lngLat={
                sectionEndPoint
                  ? [sectionEndPoint.longitude, sectionEndPoint.latitude]
                  : endPoint
                    ? [endPoint.longitude, endPoint.latitude]
                    : [0, 0]
              }
            >
              <View
                style={[
                  styles.markerContainer,
                  { opacity: creationMode && sectionEndPoint ? 1 : 0 },
                ]}
              >
                <View style={[styles.sectionCreationMarker, styles.sectionEndMarker]}>
                  <MaterialCommunityIcons name="flag" size={16} color={colors.textOnDark} />
                </View>
              </View>
            </Marker>

            {/* Numbered section markers — one MarkerView per non-PR section.
                MarkerView is used here (not a ShapeSource + CircleLayer) because
                @maplibre/maplibre-react-native's boolean filters don't reliably
                render on native, and MarkerView with React children always does.
                Each badge uses the section's palette color to match the row. */}
            {sectionNumberedMarkersGeoJSON.features.map((f) => {
              const geom = f.geometry as GeoJSON.Point;
              const coord = geom?.coordinates as [number, number] | undefined;
              const sectionId = f.properties?.sectionId as string | undefined;
              const label = f.properties?.label as string | undefined;
              if (!coord || !sectionId || !label) return null;
              const color = sectionPalette[sectionPaletteIndex(sectionId)];
              return (
                <Marker key={`num-${sectionId}`} id={`num-${sectionId}`} lngLat={coord}>
                  <Pressable
                    onPress={() => onSectionMarkerPress?.(sectionId)}
                    style={[styles.sectionNumberBadge, { backgroundColor: color }]}
                  >
                    <RNText style={styles.sectionNumberBadgeText}>{label}</RNText>
                  </Pressable>
                </Marker>
              );
            })}
            {/* PR section markers — vector trophy via MarkerView, matches feed cards. */}
            {sectionPRMarkersGeoJSON.features.map((f) => {
              const geom = f.geometry as GeoJSON.Point;
              const coord = geom?.coordinates as [number, number] | undefined;
              const sectionId = f.properties?.sectionId as string | undefined;
              if (!coord || !sectionId) return null;
              return (
                <Marker key={`pr-${sectionId}`} id={`pr-${sectionId}`} lngLat={coord}>
                  <Pressable
                    onPress={() => onSectionMarkerPress?.(sectionId)}
                    style={styles.prTrophyMarker}
                  >
                    <MaterialCommunityIcons name="trophy" size={14} color={brand.gold} />
                  </Pressable>
                </Marker>
              );
            })}

            {/* Highlight marker from chart scrubbing — rendered last so it's on top of all layers */}
            {/* Uses ShapeSource + CircleLayer because MarkerView coordinate updates break native position binding */}
            <GeoJSONSource id="highlightSource" data={highlightGeoJSON}>
              <Layer
                type="circle"
                id="highlight-border"
                style={{
                  circleRadius: 7,
                  circleColor: '#FFFFFF',
                  circleOpacity: highlightPoint ? 1 : 0,
                }}
              />
              <Layer
                type="circle"
                id="highlight-fill"
                style={{
                  circleRadius: 5,
                  circleColor: sectionPalette[0],
                  circleOpacity: highlightPoint ? 1 : 0,
                }}
              />
            </GeoJSONSource>
          </MLMap>
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
        <View style={styles.controlsContainer}>
          {/* Style toggle */}
          <TouchableOpacity
            testID="activity-map-style-toggle"
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPressIn={toggleMapStyle}
            activeOpacity={0.6}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <MaterialCommunityIcons
              name={getStyleIcon(mapStyle)}
              size={22}
              color={isDark ? colors.textOnDark : colors.textSecondary}
            />
          </TouchableOpacity>

          {/* Gradient coloring toggle — only shown when gradient data is available; hidden in 3D (no effect there) */}
          {hasGradientData && !is3DMode && (
            <TouchableOpacity
              testID="activity-map-gradient-toggle"
              accessibilityLabel={t('maps.colorByGradient')}
              style={[
                styles.controlButton,
                isDark && styles.controlButtonDark,
                gradientActive && styles.controlButtonActive,
              ]}
              onPressIn={toggleColorByGradient}
              activeOpacity={0.6}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <MaterialCommunityIcons
                name="slope-uphill"
                size={22}
                color={
                  gradientActive
                    ? colors.textOnDark
                    : isDark
                      ? colors.textOnDark
                      : colors.textSecondary
                }
              />
            </TouchableOpacity>
          )}

          {/* 3D toggle */}
          {hasRoute && (
            <TouchableOpacity
              testID="activity-map-3d-toggle"
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
                  is3DMode ? colors.textOnDark : isDark ? colors.textOnDark : colors.textSecondary
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

          {/* Fullscreen expand */}
          {enableFullscreen && (
            <TouchableOpacity
              testID="activity-map-fullscreen"
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
          {/* CRITICAL: Always render stable GeoJSONSource to avoid Fabric crash */}
          <GeoJSONSource id="fs-portion-overlays-consolidated" data={consolidatedPortionsGeoJSON}>
            <Layer
              type="line"
              id="fs-portion-overlays-casing"
              style={{
                lineColor: '#FFFFFF',
                lineWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: sectionOverlaysGeoJSON ? 0.9 : 0,
              }}
            />
            <Layer
              type="line"
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
          </GeoJSONSource>

          {/* PR markers at center of each PR section in fullscreen.
              Vector trophy via Marker for visual parity with feed cards. */}
          {fullscreenPRMarkersGeoJSON.features.map((f) => {
            const geom = f.geometry as GeoJSON.Point;
            const coord = geom?.coordinates as [number, number] | undefined;
            const sectionId = f.properties?.sectionId as string | undefined;
            if (!coord || !sectionId) return null;
            return (
              <Marker key={`fs-pr-${sectionId}`} id={`fs-pr-${sectionId}`} lngLat={coord}>
                <Pressable
                  onPress={() => onSectionMarkerPress?.(sectionId)}
                  style={styles.prTrophyBadge}
                >
                  <MaterialCommunityIcons name="trophy" size={12} color="#FFFFFF" />
                </Pressable>
              </Marker>
            );
          })}

          {/* Start marker */}
          {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
          <Marker
            id="fs-activity-start"
            lngLat={startPoint ? [startPoint.longitude, startPoint.latitude] : [0, 0]}
          >
            <View style={[styles.markerContainer, { opacity: startPoint ? 1 : 0 }]}>
              <View style={[styles.marker, styles.startMarker]} />
            </View>
          </Marker>

          {/* End marker */}
          {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
          <Marker
            id="fs-activity-end"
            lngLat={endPoint ? [endPoint.longitude, endPoint.latitude] : [0, 0]}
          >
            <View style={[styles.markerContainer, { opacity: endPoint ? 1 : 0 }]}>
              <View style={[styles.marker, styles.endMarker]} />
            </View>
          </Marker>
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

const styles = StyleSheet.create({
  outerContainer: {
    position: 'relative',
  },
  container: {
    flex: 1,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
  },
  mapLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  map3DLayer: {
    zIndex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: layout.borderRadius,
  },
  hiddenLayer: {
    opacity: 0,
    pointerEvents: 'none',
  },
  map: {
    flex: 1,
  },
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadius,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textOnDark,
  },
  sectionNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...shadows.pill,
  },
  prTrophyMarker: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -30 }],
  },
  prTrophyBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#D4AF37',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...shadows.pill,
  },
  sectionNumberBadgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
  startMarker: {
    backgroundColor: 'rgba(34,197,94,0.75)',
  },
  endMarker: {
    backgroundColor: 'rgba(239,68,68,0.75)',
  },
  sectionCreationMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textOnDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionStartMarker: {
    backgroundColor: 'rgba(34,197,94,0.9)',
  },
  sectionEndMarker: {
    backgroundColor: 'rgba(239,68,68,0.9)',
  },
  highlightMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.textOnDark,
  },
  controlsContainer: {
    position: 'absolute',
    top: 48,
    right: layout.cardMargin,
    gap: spacing.sm,
    zIndex: 100,
    elevation: 100,
  },
  controlButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.modal,
  },
  controlButtonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  controlButtonActive: {
    backgroundColor: colors.primary,
  },
});
