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

import React, {
  useMemo,
  useState,
  useRef,
  useCallback,
  useEffect,
  memo,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Modal,
  StatusBar,
  Animated,
  Text,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  MarkerView,
  CircleLayer,
  SymbolLayer,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { decodePolyline, LatLng, getActivityColor } from '@/lib';
import { colors, darkColors, typography, spacing, layout, shadows } from '@/theme';
import { useMapPreferences } from '@/providers';
import { useSectionCreation } from '@/hooks/maps/useSectionCreation';
import { useMapCamera } from '@/hooks/maps/useMapCamera';
import { useMapLayers } from '@/hooks/maps/useMapLayers';
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
  TERRAIN_ATTRIBUTION,
  getCombinedSatelliteAttribution,
} from './mapStyles';
import type { ActivityType, RoutePoint } from '@/types';

/** Attribution overlay component that manages its own state to avoid parent re-renders */
interface AttributionOverlayRef {
  setAttribution: (text: string) => void;
}

interface AttributionOverlayProps {
  initialAttribution: string;
  isFullscreen: boolean;
}

const AttributionOverlay = memo(
  forwardRef<AttributionOverlayRef, AttributionOverlayProps>(
    ({ initialAttribution, isFullscreen }, ref) => {
      const [attribution, setAttribution] = useState(initialAttribution);

      useImperativeHandle(ref, () => ({
        setAttribution,
      }));

      return (
        <View
          style={[attributionStyles.attribution, isFullscreen && attributionStyles.attributionPill]}
        >
          <Text
            style={[
              attributionStyles.attributionText,
              isFullscreen && attributionStyles.attributionTextPill,
            ]}
          >
            {attribution}
          </Text>
        </View>
      );
    }
  )
);

const attributionStyles = StyleSheet.create({
  attribution: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  attributionPill: {
    left: 'auto',
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: spacing.sm,
  },
  attributionText: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.5)',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  attributionTextPill: {
    color: colors.textSecondary,
    textShadowColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
});

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
}: ActivityMapViewProps) {
  const { t } = useTranslation();
  const { getStyleForActivity } = useMapPreferences();
  const preferredStyle = getStyleForActivity(activityType, activityId, country);
  const [mapStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? preferredStyle);
  const [isFullscreen, setIsFullscreen] = useState(false);
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

  // Track touch start for iOS tap detection (MapView.onPress doesn't fire on iOS with Fabric)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

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
    consolidatedSectionsGeoJSON,
    consolidatedPortionsGeoJSON,
    sectionMarkersGeoJSON,
    fullscreenPRMarkersGeoJSON,
    routeCoords,
    highlightPoint,
    highlightGeoJSON,
  } = useMapLayers({
    validCoordinates,
    coordinates,
    routeOverlay,
    sectionOverlays,
    highlightIndex,
    activeTab,
  });

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

  // Track 3D camera state for capture on exit
  const handleCameraStateChange = useCallback(
    (camera: { center: [number, number]; zoom: number; bearing: number; pitch: number }) => {
      camera3DRef.current = camera;
    },
    []
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

  const openFullscreen = useCallback(() => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    }
  }, [enableFullscreen]);

  const closeFullscreen = () => {
    setIsFullscreen(false);
  };

  // Handle map press - using MapView's native onPress instead of gesture detector
  // This properly distinguishes taps from zoom/pan gestures
  // Handle native map press - only used for section creation on Android
  // Fullscreen is handled by the cross-platform touch handler above
  const handleMapPress = useCallback(
    (feature: GeoJSON.Feature) => {
      if (__DEV__) {
        console.log('[ActivityMapView:Camera] handleMapPress', {
          creationMode,
          creationState,
          featureType: feature?.geometry?.type,
        });
      }
      // In creation mode, delegate to section creation hook
      if (creationMode && feature?.geometry?.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        handleCreationTap(lng, lat);
      }
    },
    [creationMode, creationState, handleCreationTap]
  );

  // iOS tap handler - converts screen coordinates to map coordinates
  // MapView.onPress doesn't fire reliably on iOS with Fabric architecture
  const handleiOSTap = useCallback(
    async (screenX: number, screenY: number) => {
      if (!mapRef.current) return;

      try {
        // Convert screen coordinates to map coordinates [lng, lat]
        const coords = await mapRef.current.getCoordinateFromView([screenX, screenY]);
        if (!coords || coords.length < 2) return;

        // Create a GeoJSON feature and call handleMapPress
        const feature: GeoJSON.Feature = {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: coords,
          },
        };

        handleMapPress(feature);
      } catch {
        // Silently fail - tap handling is best effort
      }
    },
    [handleMapPress, mapRef]
  );

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
  // Ref to update attribution without causing parent re-render
  const attributionRef = useRef<AttributionOverlayRef>(null);
  const initialAttributionRef = useRef(MAP_ATTRIBUTIONS[mapStyle]);
  // Store latest values in refs to avoid stale closure in debounced callback
  const mapStyleRef = useRef(mapStyle);
  const is3DModeRef = useRef(is3DMode);
  const onAttributionChangeRef = useRef(onAttributionChange);
  mapStyleRef.current = mapStyle;
  is3DModeRef.current = is3DMode;
  onAttributionChangeRef.current = onAttributionChange;

  // Compute attribution from current viewport - uses refs for latest values
  const computeAttributionFromRefs = useCallback(() => {
    const center = currentCenterRef.current;
    const zoom = currentZoomRef.current;
    const style = mapStyleRef.current;
    const is3D = is3DModeRef.current;

    if (style === 'satellite' && center) {
      const satAttribution = getCombinedSatelliteAttribution(
        center[1], // lat
        center[0], // lng
        zoom
      );
      return is3D ? `${satAttribution} | ${TERRAIN_ATTRIBUTION}` : satAttribution;
    }
    const baseAttribution = MAP_ATTRIBUTIONS[style];
    return is3D ? `${baseAttribution} | ${TERRAIN_ATTRIBUTION}` : baseAttribution;
  }, [currentCenterRef, currentZoomRef]);

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
              onTouchStart: (e: { nativeEvent: { locationX: number; locationY: number } }) => {
                touchStartRef.current = {
                  x: e.nativeEvent.locationX,
                  y: e.nativeEvent.locationY,
                  time: Date.now(),
                };
              },
              onTouchEnd: (e: { nativeEvent: { locationX: number; locationY: number } }) => {
                const start = touchStartRef.current;
                if (!start) return;
                const dx = Math.abs(e.nativeEvent.locationX - start.x);
                const dy = Math.abs(e.nativeEvent.locationY - start.y);
                const duration = Date.now() - start.time;
                const isTap = duration < 300 && dx < 10 && dy < 10;
                if (isTap && !isFullscreen && !(is3DMode && is3DReady)) {
                  handleiOSTap(e.nativeEvent.locationX, e.nativeEvent.locationY);
                }
                touchStartRef.current = null;
              },
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

            {/* Route overlay (matched route trace) - rendered first so activity line is on top */}
            {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
            {/* When no data, overlayGeoJSON is an empty FeatureCollection, not null */}
            <ShapeSource id="overlaySource" shape={overlayGeoJSON}>
              <LineLayer
                id="overlayLine"
                style={{
                  lineColor: '#00E5FF',
                  lineWidth: 5,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineOpacity: 0.5,
                }}
              />
            </ShapeSource>

            {/* Route line - render first so section overlays appear on top */}
            {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
            <ShapeSource id="routeSource" shape={routeGeoJSON}>
              <LineLayer
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
              <LineLayer
                id="routeLine"
                style={{
                  lineColor: activityColor,
                  lineWidth: 4,
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
            </ShapeSource>

            {/* Section overlays - render after route line so they appear on top */}
            {/* CRITICAL: Always render stable ShapeSources to avoid Fabric crash */}
            {/* Using consolidated GeoJSONs prevents add/remove cycles during state changes */}
            <ShapeSource id="section-overlays-consolidated" shape={consolidatedSectionsGeoJSON}>
              <LineLayer
                id="section-overlays-line"
                style={{
                  lineColor:
                    activeTab === 'charts'
                      ? '#D4AF37'
                      : highlightedSectionId
                        ? [
                            'case',
                            ['==', ['get', 'id'], highlightedSectionId],
                            '#FFAB00',
                            ['case', ['==', ['get', 'isPR'], true], '#D4AF37', '#00BCD4'],
                          ]
                        : ['case', ['==', ['get', 'isPR'], true], '#D4AF37', '#00BCD4'],
                  lineWidth: highlightedSectionId
                    ? ['case', ['==', ['get', 'id'], highlightedSectionId], 7, 4]
                    : 5,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineOpacity: sectionOverlaysGeoJSON
                    ? highlightedSectionId
                      ? ['case', ['==', ['get', 'id'], highlightedSectionId], 1, 0.15]
                      : 0.7
                    : 0,
                }}
              />
            </ShapeSource>
            <ShapeSource id="portion-overlays-consolidated" shape={consolidatedPortionsGeoJSON}>
              <LineLayer
                id="portion-overlays-line"
                style={{
                  lineColor: highlightedSectionId
                    ? ['case', ['==', ['get', 'id'], highlightedSectionId], '#FFAB00', '#E91E63']
                    : '#E91E63',
                  lineWidth: highlightedSectionId
                    ? ['case', ['==', ['get', 'id'], highlightedSectionId], 5, 3]
                    : 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineOpacity: sectionOverlaysGeoJSON
                    ? highlightedSectionId
                      ? ['case', ['==', ['get', 'id'], highlightedSectionId], 1, 0.15]
                      : 1
                    : 0,
                }}
              />
            </ShapeSource>

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

            {/* Section creation: selected section line */}
            {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
            <ShapeSource id="sectionSource" shape={sectionGeoJSON}>
              <LineLayer
                id="sectionLine"
                style={{
                  lineColor: colors.success,
                  lineWidth: 6,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </ShapeSource>

            {/* Section creation: start marker */}
            {/* CRITICAL: Always render to avoid camera reset when marker appears */}
            {/* Use activity start as fallback to stay within map bounds (not [0,0]) */}
            {/* Key includes startIndex to force position update (stable when null) */}
            <MarkerView
              key={`section-start-${startIndex ?? 'none'}`}
              coordinate={
                sectionStartPoint
                  ? [sectionStartPoint.longitude, sectionStartPoint.latitude]
                  : startPoint
                    ? [startPoint.longitude, startPoint.latitude]
                    : [0, 0]
              }
              allowOverlap={true}
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
            </MarkerView>

            {/* Section creation: end marker */}
            {/* CRITICAL: Always render to avoid camera reset when marker appears */}
            {/* Use activity end as fallback to stay within map bounds (not [0,0]) */}
            {/* Key includes endIndex to force position update (stable when null) */}
            <MarkerView
              key={`section-end-${endIndex ?? 'none'}`}
              coordinate={
                sectionEndPoint
                  ? [sectionEndPoint.longitude, sectionEndPoint.latitude]
                  : endPoint
                    ? [endPoint.longitude, endPoint.latitude]
                    : [0, 0]
              }
              allowOverlap={true}
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
            </MarkerView>

            {/* Section numbered/PR markers — geo-anchored so they track with map pan/zoom */}
            {/* Uses ShapeSource + CircleLayer + SymbolLayer instead of MarkerView: */}
            {/* MarkerView coordinate updates break native position binding in MapLibre RN */}
            <ShapeSource
              id="sectionMarkersSource"
              shape={sectionMarkersGeoJSON}
              onPress={(e) => {
                const sectionId = e.features[0]?.properties?.sectionId as string | undefined;
                if (sectionId) onSectionMarkerPress?.(sectionId);
              }}
            >
              <CircleLayer
                id="section-marker-circle"
                style={{
                  circleRadius: ['case', ['get', 'isPR'], 14, 12] as unknown as number,
                  circleColor: ['case', ['get', 'isPR'], '#D4AF37', '#00BCD4'] as unknown as string,
                  circleStrokeWidth: ['case', ['get', 'isPR'], 2.5, 2] as unknown as number,
                  circleStrokeColor: '#FFFFFF',
                }}
              />
              <SymbolLayer
                id="section-marker-text"
                style={{
                  textField: ['get', 'label'] as unknown as string,
                  textColor: '#FFFFFF',
                  textSize: 10,
                  textAnchor: 'center',
                  textAllowOverlap: true,
                  textIgnorePlacement: true,
                }}
              />
            </ShapeSource>

            {/* Highlight marker from chart scrubbing — rendered last so it's on top of all layers */}
            {/* Uses ShapeSource + CircleLayer because MarkerView coordinate updates break native position binding */}
            <ShapeSource id="highlightSource" shape={highlightGeoJSON}>
              <CircleLayer
                id="highlight-border"
                style={{
                  circleRadius: 7,
                  circleColor: '#FFFFFF',
                  circleOpacity: highlightPoint ? 1 : 0,
                }}
              />
              <CircleLayer
                id="highlight-fill"
                style={{
                  circleRadius: 5,
                  circleColor: '#00BCD4',
                  circleOpacity: highlightPoint ? 1 : 0,
                }}
              />
            </ShapeSource>
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
                onMapReady={handleMap3DReady}
                onBearingChange={handleBearingChange}
                onCameraStateChange={handleCameraStateChange}
                initialCamera={initial3DCamera}
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
            isFullscreen={isFullscreen}
          />
        )}

        {/* Route overlay legend */}
        {overlayHasData && !isFullscreen && (
          <View style={styles.overlayLegend}>
            <View style={styles.legendRow}>
              <View style={[styles.legendLine, { backgroundColor: '#00E5FF' }]} />
              <Text style={styles.legendText}>{t('routes.legendRoute')}</Text>
            </View>
            <View style={styles.legendRow}>
              <View style={[styles.legendLine, { backgroundColor: activityColor }]} />
              <Text style={styles.legendText}>{t('routes.thisActivity')}</Text>
            </View>
          </View>
        )}

        {/* Section overlays legend — only on Sections tab */}
        {activeTab === 'sections' &&
          sectionOverlaysGeoJSON &&
          sectionOverlaysGeoJSON.length > 0 &&
          !isFullscreen && (
            <View style={styles.overlayLegend}>
              <View style={styles.legendRow}>
                <View style={[styles.legendLine, { backgroundColor: '#00BCD4' }]} />
                <Text style={styles.legendText}>{t('routes.legendSection')}</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendLine, { backgroundColor: '#E91E63' }]} />
                <Text style={styles.legendText}>{t('routes.legendYourEffort')}</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendLine, { backgroundColor: activityColor }]} />
                <Text style={styles.legendText}>{t('routes.legendFullActivity')}</Text>
              </View>
            </View>
          )}
      </View>

      {/* Control buttons - rendered OUTSIDE map container for reliable touch handling */}
      {showStyleToggle && !isFullscreen && (
        <View style={styles.controlsContainer}>
          {/* Style toggle */}
          <TouchableOpacity
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

          {/* 3D toggle */}
          {hasRoute && (
            <TouchableOpacity
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
          {/* Section overlays in fullscreen */}
          {/* CRITICAL: Always render stable ShapeSources to avoid Fabric crash */}
          <ShapeSource id="fs-section-overlays-consolidated" shape={consolidatedSectionsGeoJSON}>
            <LineLayer
              id="fs-section-overlays-line"
              style={{
                lineColor: '#00BCD4',
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: sectionOverlaysGeoJSON ? 0.7 : 0,
              }}
            />
          </ShapeSource>
          <ShapeSource id="fs-portion-overlays-consolidated" shape={consolidatedPortionsGeoJSON}>
            <LineLayer
              id="fs-portion-overlays-line"
              style={{
                lineColor: '#E91E63',
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: sectionOverlaysGeoJSON ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* PR markers at center of each PR section in fullscreen */}
          {/* Geo-anchored via ShapeSource so markers track with pan/zoom */}
          <ShapeSource
            id="fs-section-markers-source"
            shape={fullscreenPRMarkersGeoJSON}
            onPress={(e) => {
              const sectionId = e.features[0]?.properties?.sectionId as string | undefined;
              if (sectionId) onSectionMarkerPress?.(sectionId);
            }}
          >
            <CircleLayer
              id="fs-section-marker-circle"
              style={{
                circleRadius: 14,
                circleColor: '#D4AF37',
                circleStrokeWidth: 2.5,
                circleStrokeColor: '#FFFFFF',
              }}
            />
            <SymbolLayer
              id="fs-section-marker-text"
              style={{
                textField: ['get', 'label'] as unknown as string,
                textColor: '#FFFFFF',
                textSize: 10,
                textAnchor: 'center',
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </ShapeSource>

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
  overlayLegend: {
    position: 'absolute',
    bottom: spacing.sm + 36,
    right: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: spacing.sm,
    zIndex: 10,
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendLine: {
    width: 16,
    height: 3,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 11,
    color: colors.textOnDark,
    fontWeight: '500',
  },
  prMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#D4AF37',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  prMarkerText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
});
