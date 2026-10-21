// Interactive GPS track map. Combines a MapLibre GL JS surface with a 3D
// terrain overlay, style switching, chart-scrub highlighting, and section
// creation. Layer descriptions live in activityMapLayerSpecs, the control stack
// in ActivityMapControls, and styles in ActivityMapView.styles.

import React, { useMemo, useState, useRef, useCallback, useEffect, memo } from 'react';
import { View, StatusBar, Animated, Image, useWindowDimensions } from 'react-native';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';

import { LatLng } from '@/shared/geo/polyline';
import { useMapStyleToggle } from '@/features/maps/hooks/useDrawnMapStyle';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import { buildUserLocationCollection } from '@/features/maps/lib/userLocationLayer';
import {
  getTerrainPreviewUri,
  hasTerrainPreview,
} from '@/features/maps/lib/storage/terrainPreviewCache';
import { duration, iconSize, mapPalette, themePalette, type MapPalette } from '@/theme';
import { useTheme } from '@/shared/app';
import { useMapHeldFocus } from '@/shared/app/MapSheetHost';
import { useMapPreferences } from '@/features/settings/light';
import { useSectionCreation } from '@/features/maps/hooks/useSectionCreation';
import { useMapCamera } from '@/features/maps/hooks/useMapCamera';
import { useMapLayers } from '@/features/maps/hooks/useMapLayers';
import { useStoredTrackUrl } from '@/features/maps/hooks/useStoredTrackUrl';
import { useMapFullscreen } from '@/features/maps/hooks/useMapFullscreen';
import { useThrottledValue } from '@/shared/ui/useThrottledValue';
import { useTerrainFallback } from '@/features/maps/hooks/useTerrainFallback';
import { ComponentErrorBoundary } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import {
  featureCollection,
  lngLatFromLatLngPoint,
  pointFeature,
} from '@/features/maps/lib/coordinates';
import { HIGHLIGHT_THROTTLE_MS, REGION_SETTLE_DEBOUNCE_MS } from '@/features/maps/lib/mapBudgets';
import { cameraAfter3D } from '@/features/maps/lib/cameraAfter3D';
import { visibleMapInset } from '@/features/maps/lib/activityCamera';
import type { ActivityType, ActivityStreams, RoutePoint } from '@/types';
import { BaseMapView, type BaseMap3DLayer } from './BaseMapView';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { type MapCameraState, type MapPressEvent } from './MapSurface';
import { SlottedMapSurface, useInMapSurfaceSlot, useMapSurfaceSlotLive } from './MapSurfaceSlot';
import type { MapCameraSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import {
  SectionCreationOverlay,
  type CreationState,
  type SectionCreationError,
} from './SectionCreationOverlay';
import { type MapStyleType, MAP_ATTRIBUTIONS, statusBarStyleForMap } from './mapStyles';
import { AttributionOverlay, type AttributionOverlayRef } from './AttributionOverlay';
import { ActivityMapControls } from './ActivityMapControls';
import { ActivityMapKey } from './ActivityMapKey';
import { activityKeyRows } from './activityMapKey';
import { activityMapControlCount, useMapControlColumn } from '../lib/mapControlColumnLayout';
import {
  ACTIVITY_MAP_IMAGES,
  activityMapSpecs,
  buildActivity3DCollections,
  type ActivityLayerInput,
  type ActivitySourceInput,
  buildFullscreenMatchedRouteLayers,
  buildFullscreenSectionLayers,
  buildFullscreenSectionSources,
  FULLSCREEN_SECTION_MARKER_LAYER_IDS,
} from './activityMapLayerSpecs';
import { styles } from './ActivityMapView.styles';
import { motionTiming } from '@/shared/ui/reduceMotion';

/** The 2D layer, held transparent until the surface reports one way or the other. */
export const ACTIVITY_MAP_2D_LAYER_TEST_ID = 'activity-map-2d-layer';

/** The feed's own snapshot, stood up while the surface behind it boots. */
export const ACTIVITY_MAP_POSTER_TEST_ID = 'activity-map-poster';

/** Section overlay for map visualization */
export interface SectionOverlay {
  /** Stable section identity for detail and highlight wiring */
  id: string;
  /** Section's consensus polyline */
  sectionPolyline: LatLng[];
  /** Activity's trace portion that overlaps with this section */
  activityPortion?: LatLng[] | undefined;
  /** Whether the current activity holds the PR for this section */
  isPR?: boolean | undefined;
  /** Stable map identity for direction-aware overlays */
  overlayKey?: string | undefined;
  /** Tie-breaker for equal track order */
  sortOrder?: number | undefined;
  /** Optional encounter direction label for dual-direction sections */
  encounterDirection?: string | undefined;
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
  coordinates?: LatLng[] | undefined;
  activityType: ActivityType;
  /** Activity ID - used to resolve per-activity map style overrides */
  activityId?: string | undefined;
  /** Whether the engine holds the track, so the line is drawn from the engine's URL */
  hasStoredTrack?: boolean | undefined;
  height?: number | undefined;
  /** Height covered at the map's bottom, such as the hero's name and stats, which a fit keeps the track above. */
  coveredBottom?: number | undefined;
  /** Corner radius of the rounded sheet top under `coveredBottom`, which the credit keeps clear of. */
  coveredBottomRadius?: number | undefined;
  showStyleToggle?: boolean | undefined;
  /** Show map attribution (default: true) */
  showAttribution?: boolean | undefined;
  initialStyle?: MapStyleType | undefined;
  /** Index into coordinates array to highlight (from elevation chart) */
  highlightIndex?: number | null | undefined;
  /** Enable fullscreen on tap */
  enableFullscreen?: boolean | undefined;
  /** Called when 3D mode is toggled - parent can disable scroll */
  on3DModeChange?: ((is3D: boolean) => void) | undefined;
  /** Called when map style changes - parent can update attribution */
  onStyleChange?: ((style: MapStyleType) => void) | undefined;
  /** Called when attribution text changes (due to style or viewport change) */
  onAttributionChange?: ((attribution: string) => void) | undefined;
  /** Buttons the control column draws, so a parent drawing text beside it reserves only their width. */
  onControlCountChange?: ((count: number) => void) | undefined;
  /** Enable section creation mode */
  creationMode?: boolean | undefined;
  /** Current section creation state (parent-controlled) */
  creationState?: CreationState | undefined;
  /** Error details for section creation */
  creationError?: SectionCreationError | null | undefined;
  /** Called when a section is created */
  onSectionCreated?: ((result: SectionCreationResult) => void) | undefined;
  /** Called when section creation is cancelled */
  onCreationCancelled?: (() => void) | undefined;
  /** Called to dismiss error and retry */
  onCreationErrorDismiss?: (() => void) | undefined;
  /** Route overlay coordinates to show (e.g., matched route trace) */
  routeOverlay?: LatLng[] | null | undefined;
  /** Section overlays for sections tab - all matched sections with activity portions */
  sectionOverlays?: SectionOverlay[] | null | undefined;
  /** Sections-tab card label per sectionId, so numbered markers match the cards */
  sectionRowLabels?: ReadonlyMap<string, string> | undefined;
  /** Active tab - controls section line color and legend visibility */
  activeTab?: string | undefined;
  /** Section ID to highlight (dims other sections when set) */
  highlightedSectionId?: string | null | undefined;
  /** Called when a section marker is tapped on the map */
  onSectionMarkerPress?: ((sectionId: string) => void) | undefined;
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
  /** Activity streams - required to compute per-point gradient coloring */
  streams?: ActivityStreams | null | undefined;
}

export const ActivityMapView = memo(function ActivityMapView({
  coordinates: providedCoordinates,
  activityType,
  activityId,
  hasStoredTrack,
  height = 300,
  coveredBottom = 0,
  coveredBottomRadius = 0,
  showStyleToggle = false,
  showAttribution = true,
  initialStyle,
  highlightIndex,
  enableFullscreen = false,
  on3DModeChange,
  onStyleChange,
  onAttributionChange,
  onControlCountChange,
  creationMode = false,
  creationState: externalCreationState,
  creationError,
  onSectionCreated,
  onCreationCancelled,
  onCreationErrorDismiss,
  routeOverlay,
  sectionOverlays,
  sectionRowLabels,
  activeTab,
  highlightedSectionId,
  onSectionMarkerPress,
  onCameraCapture,
  initial3DCamera,
  streams,
}: ActivityMapViewProps) {
  // The placeholder and every control drawn over the map follow the app theme, not the base.
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const { getStyleForActivity } = useMapPreferences();
  const preferredStyle = getStyleForActivity(activityType, activityId);
  const [chosenStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? preferredStyle);
  // Track if user manually overrode the style
  const [userOverride, setUserOverride] = useState(false);
  const chooseStyle = useCallback((next: MapStyleType) => {
    setUserOverride(true);
    setMapStyle(next);
  }, []);
  const { drawn: mapStyle, cycle: toggleMapStyle } = useMapStyleToggle(chosenStyle, chooseStyle);
  const { isFullscreen, openFullscreen, closeFullscreen } = useMapFullscreen({ enableFullscreen });
  const [is3DMode, setIs3DMode] = useState(!!initial3DCamera);
  const [is3DReady, setIs3DReady] = useState(false);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  // A screen covered by another keeps its WebViews but releases their maps,
  // which hold the GL context and every tile texture in it. Inside a detail host the screen is
  // the host's, so the map stays held under its own sheet.
  const screenFocused = useMapHeldFocus();
  const map3DOpacity = useRef(new Animated.Value(0)).current;

  // Track the latest 3D camera state for capture on exit
  const camera3DRef = useRef<{
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  } | null>(null);
  // The last camera an athlete's gesture left. The page also posts one for its
  // own resize and fit, which is not an angle anyone chose.
  const gestureCameraRef = useRef<typeof camera3DRef.current>(null);
  const prev3DModeRef = useRef(false);
  // A page that could not draw is not the athlete choosing the flat map. The
  // caller persists what it is told, ahead of the per-sport and the global
  // preference and with nothing to clear it, so one failed load turned 3D off
  // for that activity for ever on a device where nobody touched the toggle.
  const modeFromFailureRef = useRef(false);
  // The athlete's own toggle or a failed page both settle the mode for this
  // visit, so a camera that arrives afterwards must not override either.
  const userChose3DRef = useRef(false);
  const hadInitialCameraRef = useRef(!!initial3DCamera);

  // Parse and validate coordinates early so they're available for callbacks
  const coordinates = useMemo(() => {
    if (providedCoordinates && providedCoordinates.length > 0) {
      return providedCoordinates;
    }
    return [];
  }, [providedCoordinates]);

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
    currentBoundsRef,
    currentZoomRef,
    bearingAnim,
    locationLoading,
    userLocation,
    handleMapReady,
    handleMapFailed,
    resetSurface,
    handleRegionIsChanging,
    handleRegionDidChange: handleCameraRegionDidChange,
    settledCameraRef,
    resetOrientation,
    handleGetLocation,
  } = useMapCamera({
    validCoordinates,
    is3DMode,
    is3DReady,
    map3DRef,
  });

  // The line comes from the engine whenever it holds the track, so the page
  // fetches it rather than taking it as text on every mount.
  const trackUrl = useStoredTrackUrl(activityId, hasStoredTrack ?? false);

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
    sectionRowLabels,
    highlightIndex,
    activeTab,
    streams,
    trackUrl,
    mapStyle,
  });

  const inline3DCollections = useMemo(
    () =>
      buildActivity3DCollections({
        portions: consolidatedPortionsGeoJSON,
        matchedRoute: overlayGeoJSON,
        markers: sectionMarkersGeoJSON,
        boundaries: sectionBoundariesGeoJSON,
      }),
    [consolidatedPortionsGeoJSON, overlayGeoJSON, sectionMarkersGeoJSON, sectionBoundariesGeoJSON]
  );

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
    if (!userOverride && !initialStyle && chosenStyle !== preferredStyle) {
      setMapStyle(preferredStyle);
    }
  }, [userOverride, initialStyle, chosenStyle, preferredStyle]);

  // Toggle 3D mode
  const toggle3D = useCallback(() => {
    userChose3DRef.current = true;
    setIs3DMode((current) => !current);
  }, []);

  // Streams stored after the screen opened turn the camera from null into one.
  // Switch on once, and leave the preference alone since the athlete did not ask.
  useEffect(() => {
    if (!initial3DCamera || hadInitialCameraRef.current) return;
    hadInitialCameraRef.current = true;
    if (userChose3DRef.current || modeFromFailureRef.current) return;
    modeFromFailureRef.current = true;
    setIs3DMode(true);
  }, [initial3DCamera]);

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
    // A new handler is not a new choice: only a change of mode is written.
    if (prev3DModeRef.current === is3DMode) return;
    const gestureCamera = gestureCameraRef.current;
    if (!is3DMode) gestureCameraRef.current = null;
    const captured =
      !is3DMode && !!gestureCamera && !modeFromFailureRef.current && !!onCameraCapture;
    if (captured) onCameraCapture(gestureCamera);
    prev3DModeRef.current = is3DMode;
    // The failure keeps the local state and leaves the preference alone, so
    // the next open tries again rather than mounting flat for ever.
    if (modeFromFailureRef.current) {
      modeFromFailureRef.current = false;
      return;
    }
    // The captured angle is a 3D render of the activity, so leaving the view
    // after moving the camera does not turn 3D off for it.
    if (captured) return;
    on3DModeChange?.(is3DMode);
  }, [is3DMode, on3DModeChange, onCameraCapture]);

  // Notify parent when map style changes (skip initial mount - only user-initiated changes)
  const styleInitRef = useRef(true);
  useEffect(() => {
    if (styleInitRef.current) {
      styleInitRef.current = false;
      return;
    }
    onStyleChange?.(chosenStyle);
  }, [chosenStyle, onStyleChange]);

  // A camera from an earlier 3D visit is not where this one was left.
  useEffect(() => {
    if (is3DMode) camera3DRef.current = null;
  }, [is3DMode]);

  // Reset 3D ready state when toggling off
  useEffect(() => {
    if (!is3DMode) {
      setIs3DReady(false);
      setMap3DCrashed(false);
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
    (
      camera: { center: [number, number]; zoom: number; bearing: number; pitch: number },
      gesture: boolean
    ) => {
      camera3DRef.current = camera;
      if (gesture) gestureCameraRef.current = camera;
      if (is3DModeRef.current) {
        currentCenterRef.current = camera.center;
        currentZoomRef.current = camera.zoom;
        // The 3D camera reports no extent, so the credit follows its centre.
        currentBoundsRef.current = null;
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
    [currentCenterRef, currentZoomRef, currentBoundsRef]
  );

  // The 3D layer is the only thing that can clear its own spinner, so a page
  // that cannot render drops back to the 2D map rather than spinning forever.
  // Same landing as the error boundary below.
  const handleMap3DFailed = useCallback(() => {
    modeFromFailureRef.current = true;
    userChose3DRef.current = true;
    setIs3DReady(false);
    setIs3DMode(false);
  }, []);

  const { onTerrainUnavailable, terrainNotice } = useTerrainFallback(handleMap3DFailed);

  // Handle 3D map ready
  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    motionTiming(map3DOpacity, {
      toValue: 1,
      duration: duration.slow,
      useNativeDriver: true,
    }).start();
  }, [map3DOpacity]);

  // A page that crashed once may crash again, so from then on the 2D map
  // stands behind it rather than the poster alone.
  const [map3DCrashed, setMap3DCrashed] = useState(false);
  const handleMap3DReloading = useCallback(() => {
    map3DOpacity.stopAnimation();
    map3DOpacity.setValue(0);
    setIs3DReady(false);
    setMap3DCrashed(true);
  }, [map3DOpacity]);

  // The card that was just tapped was drawn from a JPEG of this activity, in
  // this style and this camera, and it is already on disk. The surface behind
  // it takes 1.4 s on ground it has seen and up to 4.3 s on ground it has not
  // (test handset, debug Android build with production JavaScript), and it used to
  // spend all of that dark. The image
  // is the feed's aspect, so covering the hero may crop it, which is worth it
  // for the seconds it stands.
  const posterUri = useMemo(() => {
    if (!activityId) return null;
    // The card and this screen decide smart 3D from different inputs, so the
    // card may have written only the other render. Its picture of the same
    // ground still beats a dark surface.
    for (const mode of [is3DMode, !is3DMode]) {
      if (hasTerrainPreview(activityId, mapStyle, mode)) {
        return getTerrainPreviewUri(activityId, mapStyle, mode);
      }
    }
    return null;
  }, [activityId, mapStyle, is3DMode]);

  // The 3D layer draws over the 2D one once it is ready, and fullscreen draws
  // over both, so in either case the inline 2D surface is invisible and comes
  // down rather than being hidden. Where it was is captured on the way out, so
  // the remount opens there instead of fitting the track again. While the 3D
  // page boots the poster covers the hero, so a 2D page not already on screen
  // is not built behind it: creating that WebView costs the tap's first frames.
  const is3DLoading = is3DMode && !is3DReady;
  const posterCovers3DBoot =
    is3DLoading && posterUri !== null && !(mapReady || mapFailed) && !map3DCrashed;
  // A slot's surface is shared with the subjects beneath this one, so it stays under the 3D
  // layer and the fullscreen map, and popping back to a flat subject needs no load.
  const inSlot = useInMapSurfaceSlot();
  const show2DSurface =
    inSlot || (!(is3DMode && is3DReady) && !isFullscreen && !posterCovers3DBoot);
  const touchThrough = inSlot ? 'box-none' : 'auto';

  // The commit that mounts this view is the open's own frame, and creating a map page in it
  // took 38 to 53 ms of a frame already over a tap's budget (test handset, release build). So the page,
  // 2D or 3D, is created on the next frame, transparent until ready and under the poster where
  // there is one. A slot whose surface is already up creates no page, so the view publishes at once.
  const slotLive = useMapSurfaceSlotLive();
  const [pageDue, setPageDue] = useState(slotLive);
  useEffect(() => {
    if (pageDue) return undefined;
    const frame = requestAnimationFrame(() => setPageDue(true));
    return () => cancelAnimationFrame(frame);
  }, [pageDue]);

  const surfaceReady = is3DMode ? is3DReady : mapReady || mapFailed;
  const [camera2DOnHide, setCamera2DOnHide] = useState<MapCameraSpec | null>(null);
  useEffect(() => {
    if (!show2DSurface) {
      setCamera2DOnHide(settledCameraRef.current);
      resetSurface();
    }
  }, [show2DSurface, settledCameraRef, resetSurface]);

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

  const startPoint = validCoordinates[0];
  const endPoint = validCoordinates[validCoordinates.length - 1];

  const hasRoute = routeCoords.length > 0;
  // The fullscreen modal covers the hero, so its hidden column keeps its reserve and the hero text
  // does not reflow on the way back.
  const controlCount = activityMapControlCount({
    shown: showStyleToggle && bounds != null && validCoordinates.length > 0,
    hasGradientData,
    hasRoute,
    enableFullscreen,
  });
  useEffect(() => {
    onControlCountChange?.(controlCount);
  }, [controlCount, onControlCountChange]);
  // The key sits opposite the control column, at the same height.
  const { top: keyTop, footprint: controlFootprint } = useMapControlColumn(height, controlCount);
  // The track is fitted to what the header, the column and the hero's overlay leave visible.
  const { width: mapWidth } = useWindowDimensions();
  const fitPadding = useMemo(
    () =>
      visibleMapInset({
        width: mapWidth,
        height,
        coveredTop: keyTop,
        coveredBottom,
        coveredRight: controlFootprint,
      }),
    [mapWidth, height, keyTop, coveredBottom, controlFootprint]
  );

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

  const userLocationGeoJSON = useMemo(
    () => buildUserLocationCollection(userLocation),
    [userLocation]
  );

  const sourceInput = useMemo(
    (): ActivitySourceInput => ({
      routeGeoJSON,
      overlayGeoJSON,
      consolidatedPortionsGeoJSON,
      sectionBoundariesGeoJSON,
      sectionMarkersGeoJSON,
      highlightGeoJSON: throttledHighlight,
      endpointsGeoJSON,
      sectionCreationLine: sectionGeoJSON,
      sectionCreationMarkers,
      userLocationGeoJSON,
    }),
    [
      routeGeoJSON,
      overlayGeoJSON,
      consolidatedPortionsGeoJSON,
      sectionBoundariesGeoJSON,
      sectionMarkersGeoJSON,
      throttledHighlight,
      endpointsGeoJSON,
      sectionGeoJSON,
      sectionCreationMarkers,
      userLocationGeoJSON,
    ]
  );

  // Held while the point is, so the 3D page is sent a highlight only when it moves.
  const highlightCoordinate = useMemo(
    (): [number, number] | null =>
      highlightPoint ? [highlightPoint.longitude, highlightPoint.latitude] : null,
    [highlightPoint]
  );

  // Keyed on whether there is a highlight, not where it is, so a scrub leaves
  // the layer list alone.
  const hasHighlightPoint = !!highlightPoint;
  const hasSectionOverlays = !!sectionOverlaysGeoJSON;
  const hasRecord = !!sectionOverlaysGeoJSON?.some((overlay) => overlay.isPR);
  const basePalette = mapPalette(mapStyle);
  const keyRows = useMemo(
    () =>
      activityKeyRows({
        palette: basePalette,
        overlayHasData,
        gradientActive,
        hasSectionOverlays,
        hasRecord,
        highlightedSectionId,
      }),
    [
      basePalette,
      overlayHasData,
      gradientActive,
      hasSectionOverlays,
      hasRecord,
      highlightedSectionId,
    ]
  );
  const layerInput = useMemo(
    (): ActivityLayerInput => ({
      palette: basePalette,
      overlayHasData,
      gradientActive,
      gradientLineExpression,
      hasSectionOverlays,
      highlightedSectionId,
      hasHighlightPoint,
      creationMode,
      hasUserLocation: userLocation !== null,
    }),
    [
      basePalette,
      overlayHasData,
      gradientActive,
      gradientLineExpression,
      hasSectionOverlays,
      highlightedSectionId,
      hasHighlightPoint,
      creationMode,
      userLocation,
    ]
  );

  const specs = useMemo(
    () =>
      activityMapSpecs({ sources: sourceInput, layers: layerInput, coordinates: validCoordinates }),
    [sourceInput, layerInput, validCoordinates]
  );

  const fullscreenSources = useMemo(
    () =>
      buildFullscreenSectionSources(
        consolidatedPortionsGeoJSON,
        fullscreenPRMarkersGeoJSON,
        overlayGeoJSON
      ),
    [consolidatedPortionsGeoJSON, fullscreenPRMarkersGeoJSON, overlayGeoJSON]
  );
  const fullscreenLayers = useCallback(
    (fullscreenPalette: MapPalette) =>
      buildFullscreenSectionLayers(!!sectionOverlaysGeoJSON, fullscreenPalette),
    [sectionOverlaysGeoJSON]
  );
  const fullscreenMatchedRouteLayers = useCallback(
    (fullscreenPalette: MapPalette) =>
      buildFullscreenMatchedRouteLayers(overlayHasData, fullscreenPalette),
    [overlayHasData]
  );

  // The fullscreen 3D layer draws what fullscreen draws in 2D: the portions,
  // the matched route and the PR markers, whose tap opens the section.
  const fullscreenLayer3D = useMemo<BaseMap3DLayer>(
    () => ({
      ...buildActivity3DCollections({
        portions: consolidatedPortionsGeoJSON,
        matchedRoute: overlayGeoJSON,
        markers: fullscreenPRMarkersGeoJSON,
      }),
      onSectionClick: handle3DSectionClick,
    }),
    [consolidatedPortionsGeoJSON, overlayGeoJSON, fullscreenPRMarkersGeoJSON, handle3DSectionClick]
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
        bounds: currentBoundsRef.current,
      }),
    [currentCenterRef, currentZoomRef, currentBoundsRef]
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
      <View style={[styles.placeholder, { height, backgroundColor: palette.surfacePage }]}>
        <Icon name="map-marker-off" size={iconSize.xxl} color={palette.textSecondary} />
      </View>
    );
  }

  return (
    <View style={[styles.outerContainer, { height }]} pointerEvents={touchThrough}>
      <View style={styles.container} pointerEvents={touchThrough}>
        {/* The snapshot the feed drew, under everything, until a surface is up. */}
        {posterUri && !surfaceReady ? (
          <Image
            accessibilityIgnoresInvertColors
            testID={ACTIVITY_MAP_POSTER_TEST_ID}
            source={{ uri: posterUri }}
            fadeDuration={0}
            style={styles.mapLayer}
            resizeMode="cover"
          />
        ) : null}

        {/* 2D Map layer. Unmounted, not hidden, whenever another surface is the
            one being looked at: a hidden WebView keeps its GL context and its
            tile textures, which is the whole cost of having it. */}
        {show2DSurface && pageDue ? (
          <View style={styles.mapLayer} pointerEvents={touchThrough}>
            <View
              style={[styles.map, { opacity: mapReady || mapFailed ? 1 : 0 }]}
              pointerEvents={touchThrough}
              testID={ACTIVITY_MAP_2D_LAYER_TEST_ID}
            >
              <SlottedMapSurface
                ref={surfaceRef}
                mapStyle={mapStyle}
                initialCamera={
                  cameraAfter3D(camera3DRef.current, camera2DOnHide) ?? {
                    bounds: { sw: bounds.sw, ne: bounds.ne },
                    padding: fitPadding,
                  }
                }
                sources={specs.sources}
                layers={specs.layers}
                images={specs.images}
                interactiveLayers={specs.interactiveLayers}
                released={!screenFocused}
                onMapReady={handleMapReady}
                onMapFailed={handleMapFailed}
                onPress={handleSurfacePress}
                onRegionIsChanging={handleRegionIsChanging}
                onRegionDidChange={handleRegionDidChange}
              />
            </View>
          </View>
        ) : null}

        {/* 3D Map layer */}
        {/* Error boundary prevents a 3D crash from taking out the entire map */}
        {is3DMode && hasRoute && !isFullscreen && pageDue ? (
          <ComponentErrorBoundary part="map3d" debugName="3D Map" onError={handleMap3DFailed}>
            <Animated.View
              style={[styles.mapLayer, styles.map3DLayer, { opacity: map3DOpacity }]}
              pointerEvents={is3DReady ? 'auto' : 'none'}
            >
              <Map3DWebView
                ref={map3DRef}
                coordinates={routeCoords}
                mapStyle={mapStyle}
                routeColor={basePalette.route}
                fitPadding={fitPadding}
                routeGradient={gradientActive ? gradientLineExpression : null}
                highlightCoordinate={highlightCoordinate}
                {...inline3DCollections}
                highlightedSectionId={highlightedSectionId}
                released={!screenFocused}
                onMapReady={handleMap3DReady}
                onMapReloading={handleMap3DReloading}
                onMapFailed={handleMap3DFailed}
                onTerrainUnavailable={onTerrainUnavailable}
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
        ) : null}

        {terrainNotice}

        {/* Attribution - uses ref-based updates to avoid map re-renders */}
        {showAttribution || isFullscreen ? (
          <AttributionOverlay
            ref={attributionRef}
            initialAttribution={initialAttributionRef.current}
            bottomInset={coveredBottom}
            edgeRadius={coveredBottomRadius}
          />
        ) : null}
      </View>

      {!isFullscreen ? (
        <ActivityMapKey rows={keyRows} palette={basePalette} isDark={isDark} top={keyTop} />
      ) : null}

      {/* Control buttons - rendered OUTSIDE map container for reliable touch handling */}
      {showStyleToggle && !isFullscreen ? (
        <ActivityMapControls
          mapStyle={mapStyle}
          onToggleStyle={toggleMapStyle}
          hasGradientData={hasGradientData}
          gradientActive={gradientActive}
          onToggleGradient={toggleColorByGradient}
          is3DMode={is3DMode}
          is3DLoading={is3DLoading}
          hasRoute={hasRoute}
          onToggle3D={toggle3D}
          bearingAnim={bearingAnim}
          onResetOrientation={resetOrientation}
          locationLoading={locationLoading}
          userLocationActive={userLocation !== null}
          onGetLocation={handleGetLocation}
          enableFullscreen={enableFullscreen}
          onOpenFullscreen={openFullscreen}
          mapHeight={height}
        />
      ) : null}

      {/* Fullscreen modal using BaseMapView */}
      <FullWindowModal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <StatusBar barStyle={`${statusBarStyleForMap(mapStyle)}-content`} />
        <BaseMapView
          routeCoordinates={routeCoords}
          bounds={bounds}
          initialStyle={chosenStyle}
          onClose={closeFullscreen}
          overlaySources={fullscreenSources}
          overlayLayers={fullscreenLayers}
          underRouteLayers={fullscreenMatchedRouteLayers}
          overlayImages={ACTIVITY_MAP_IMAGES}
          interactiveLayers={FULLSCREEN_SECTION_MARKER_LAYER_IDS}
          onPress={handleFullscreenPress}
          layer3D={fullscreenLayer3D}
        />
      </FullWindowModal>

      {/* Section creation overlay */}
      {creationMode ? (
        <SectionCreationOverlay
          state={externalCreationState ?? creationState}
          startIndex={startIndex}
          sectionDistance={sectionDistance}
          sectionPointCount={sectionPointCount}
          error={creationError}
          onConfirm={handleCreationConfirm}
          onCancel={handleCreationCancel}
          onReset={handleCreationReset}
          onDismissError={onCreationErrorDismiss}
        />
      ) : null}
    </View>
  );
});
