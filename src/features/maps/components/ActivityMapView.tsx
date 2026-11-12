// Interactive GPS track map. One MapLibre GL JS surface, tilted over terrain
// for 3D, with style switching, chart-scrub highlighting, and section
// creation. Layer descriptions live in activityMapLayerSpecs, the control stack
// in ActivityMapControls, and styles in ActivityMapView.styles.

import React, { useMemo, useState, useRef, useCallback, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StatusBar, Image, useWindowDimensions } from 'react-native';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';

import { LatLng } from '@/shared/geo/polyline';
import { useMapStyleToggle } from '@/features/maps/hooks/useDrawnMapStyle';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import { buildUserLocationCollection } from '@/features/maps/lib/userLocationLayer';
import {
  getTerrainPreviewUri,
  hasTerrainPreview,
} from '@/features/maps/lib/storage/terrainPreviewCache';
import { cameraMove, iconSize, mapPalette, themePalette, type MapPalette } from '@/theme';
import { useTheme } from '@/shared/app';
import { useSharedTerrain3D } from '@/features/maps/hooks/useHostTerrain3D';
import { useMapHeldFocus, useMapSheetHost } from '@/shared/app/MapSheetHost';
import { useMapPreferences } from '@/features/settings/light';
import { useSectionCreation } from '@/features/maps/hooks/useSectionCreation';
import { useMapCamera } from '@/features/maps/hooks/useMapCamera';
import { useMapLayers } from '@/features/maps/hooks/useMapLayers';
import { useStoredTrackUrl } from '@/features/maps/hooks/useStoredTrackUrl';
import { useMapFullscreen } from '@/features/maps/hooks/useMapFullscreen';
import { useThrottledValue } from '@/shared/ui/useThrottledValue';
import { useTerrainFallback } from '@/features/maps/hooks/useTerrainFallback';
import { Icon } from '@/shared/ui/Icon';
import { Spinner } from '@/shared/ui/Spinner';
import {
  featureCollection,
  lngLatFromLatLngPoint,
  pointFeature,
} from '@/features/maps/lib/coordinates';
import { HIGHLIGHT_THROTTLE_MS, REGION_SETTLE_DEBOUNCE_MS } from '@/features/maps/lib/mapBudgets';
import { TRACK_FIT_PADDING, visibleMapInset } from '@/features/maps/lib/activityCamera';
import { paddedFit, terrainOpeningCamera } from '@/features/maps/lib/cameraPadding';
import { useSettleCamera } from '@/features/maps/lib/useSettleCamera';
import type { ActivityType, ActivityStreams, RoutePoint } from '@/types';
import { BaseMapView } from './BaseMapView';
import { type MapCameraState, type MapPressEvent } from './MapSurface';
import { SlottedMapSurface, useInMapSurfaceSlot, useMapSurfaceSlotLive } from './MapSurfaceSlot';
import type { MapCameraSpec, MapTerrainSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import {
  SectionCreationOverlay,
  type CreationState,
  type SectionCreationError,
} from './SectionCreationOverlay';
import {
  type MapStyleType,
  MAP_ATTRIBUTIONS,
  TERRAIN_3D_CONFIG,
  statusBarStyleForMap,
} from './mapStyles';
import { AttributionOverlay, type AttributionOverlayRef } from './AttributionOverlay';
import { ActivityMapControls } from './ActivityMapControls';
import { ActivityMapKey } from './ActivityMapKey';
import { activityKeyRows } from './activityMapKey';
import { withContextLayers } from '../lib/contextLayerSpecs';
import { useDetailLayers } from './DetailMapLayers';
import { activityMapControlCount, useMapControlColumn } from '../lib/mapControlColumnLayout';
import {
  ACTIVITY_MAP_IMAGES,
  activityMapSpecs,
  type ActivityLayerInput,
  type ActivitySourceInput,
  buildFullscreenMatchedRouteLayers,
  buildFullscreenSectionLayers,
  buildFullscreenSectionSources,
  FULLSCREEN_SECTION_MARKER_LAYER_IDS,
} from './activityMapLayerSpecs';
import { styles } from './ActivityMapView.styles';

/** The 2D layer, held transparent until the surface reports one way or the other. */
export const ACTIVITY_MAP_2D_LAYER_TEST_ID = 'activity-map-2d-layer';

/** The feed's own snapshot, stood up while the surface behind it boots. */
export const ACTIVITY_MAP_POSTER_TEST_ID = 'activity-map-poster';

/** The wait cue over the snapshot while the surface boots in 3D. */
export const ACTIVITY_MAP_LOADING_CUE_TEST_ID = 'activity-map-loading-cue';

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
  /** Width covered at the map's left, such as a regular-width side panel the track is fitted beside. */
  coveredLeft?: number | undefined;
  /** Width covered at the map's right, such as a side panel in a right-to-left layout. */
  coveredRight?: number | undefined;
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
  /** Opens the library section or route a tap landed on, returning whether it named one. */
  onContextPress?: ((event: MapPressEvent) => boolean) | undefined;
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
  /** The initial 3D camera is the athlete's own, and is never turned off a hiding ridge */
  initial3DCameraPinned?: boolean;
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
  coveredLeft = 0,
  coveredRight = 0,
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
  onContextPress,
  onCameraCapture,
  initial3DCamera,
  initial3DCameraPinned,
  streams,
}: ActivityMapViewProps) {
  // The placeholder and every control drawn over the map follow the app theme, not the base.
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const { getStyleForActivity } = useMapPreferences();
  const preferredStyle = getStyleForActivity(activityType, activityId);
  const { t } = useTranslation();
  const [chosenStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? preferredStyle);
  // Track if user manually overrode the style
  const [userOverride, setUserOverride] = useState(false);
  const chooseStyle = useCallback((next: MapStyleType) => {
    setUserOverride(true);
    setMapStyle(next);
  }, []);
  const {
    drawn: mapStyle,
    next: nextMapStyle,
    cycle: toggleMapStyle,
  } = useMapStyleToggle(chosenStyle, chooseStyle);
  const { isFullscreen, openFullscreen, closeFullscreen } = useMapFullscreen({ enableFullscreen });
  const {
    is3D: is3DMode,
    setIs3D: setIs3DMode,
    inherited: modeInherited,
  } = useSharedTerrain3D(!!initial3DCamera);
  // A screen covered by another keeps its WebViews but releases their maps,
  // which hold the GL context and every tile texture in it. Inside a detail host the screen is
  // the host's, so the map stays held under its own sheet.
  const sheetKey = useMapSheetHost()?.key;
  const screenFocused = useMapHeldFocus();

  // The last camera an athlete's gesture left in 3D. The page also posts one for its
  // own resize and fit, which is not an angle anyone chose.
  const gestureCameraRef = useRef<{
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  } | null>(null);
  const markAthleteMovedRef = useRef<() => void>(() => {});
  const prev3DModeRef = useRef(false);
  // A page with no elevation tiles is not the athlete choosing the flat map. The
  // caller persists what it is told, ahead of the per-sport and the global
  // preference and with nothing to clear it, so one failed load turned 3D off
  // for that activity for ever on a device where nobody touched the toggle.
  const modeFromFailureRef = useRef(false);
  // The athlete's own toggle or a failed page both settle the mode for this
  // visit, so a camera that arrives afterwards must not override either.
  const userChose3DRef = useRef(modeInherited);
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
  } = useMapCamera({ validCoordinates });

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
  }, [setIs3DMode]);

  // Streams stored after the screen opened turn the camera from null into one.
  // Switch on once, and leave the preference alone since the athlete did not ask.
  useEffect(() => {
    if (!initial3DCamera || hadInitialCameraRef.current) return;
    hadInitialCameraRef.current = true;
    if (userChose3DRef.current || modeFromFailureRef.current) return;
    modeFromFailureRef.current = true;
    setIs3DMode(true);
  }, [initial3DCamera, setIs3DMode]);

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

  // Refs the attribution pipeline reads, so a camera event always sees the latest values.
  const attributionRef = useRef<AttributionOverlayRef>(null);
  const initialAttributionRef = useRef(MAP_ATTRIBUTIONS[mapStyle]);
  const mapStyleRef = useRef(mapStyle);
  const is3DModeRef = useRef(is3DMode);
  const onAttributionChangeRef = useRef(onAttributionChange);
  mapStyleRef.current = mapStyle;
  is3DModeRef.current = is3DMode;
  onAttributionChangeRef.current = onAttributionChange;

  // A page with no elevation tiles draws the flat map with 3D on top, so the map leaves 3D and
  // says why. The mode is not the athlete's choice and is not reported as one.
  const leave3DForMissingTerrain = useCallback(() => {
    modeFromFailureRef.current = true;
    userChose3DRef.current = true;
    setIs3DMode(false);
  }, [setIs3DMode]);

  const { onTerrainUnavailable, terrainNotice } = useTerrainFallback(leave3DForMissingTerrain);

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

  // Fullscreen draws its own map over this one, so the inline surface comes down rather than
  // being hidden. Where it was is captured on the way out, so the remount opens there instead of
  // fitting the track again. A slot's surface is shared with the subjects beneath this one, so it
  // stays under the fullscreen map, and popping back to a flat subject needs no load.
  const inSlot = useInMapSurfaceSlot();
  const show2DSurface = inSlot || !isFullscreen;
  const touchThrough = inSlot ? 'box-none' : 'auto';

  // The commit that mounts this view is the open's own frame, and creating a map page in it
  // took 38 to 53 ms of a frame already over a tap's budget (test handset, release build). So the page,
  // 2D or 3D, is created two frames on, transparent until ready and under the poster where
  // there is one. The detail's own views mount in the first of those frames (about 80 of them, with
  // the page's WebView in the same frame it ran 106 to 120 ms), so the page takes the frame after.
  // A slot whose surface is already up creates no page, so the view publishes at once.
  const slotLive = useMapSurfaceSlotLive();
  const [pageDue, setPageDue] = useState(slotLive);
  useEffect(() => {
    if (pageDue) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPageDue(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [pageDue]);

  const surfaceReady = mapReady || mapFailed;
  const [camera2DOnHide, setCamera2DOnHide] = useState<MapCameraSpec | null>(null);
  useEffect(() => {
    if (!show2DSurface) {
      setCamera2DOnHide(settledCameraRef.current);
      resetSurface();
    }
  }, [show2DSurface, settledCameraRef, resetSurface]);

  // One tap path for the flat map and 3D: the page resolves the hit and tells us
  // whether a section marker was under the finger before we treat the tap as a
  // section-creation point.
  const handleSurfacePress = useCallback(
    (event: MapPressEvent) => {
      const { coordinate, feature } = event;
      const sectionId = feature?.properties?.sectionId;
      if (typeof sectionId === 'string') {
        onSectionMarkerPress?.(sectionId);
        return;
      }
      if (creationMode) {
        handleCreationTap(coordinate[0], coordinate[1]);
        return;
      }
      onContextPress?.(event);
    },
    [creationMode, handleCreationTap, onSectionMarkerPress, onContextPress]
  );

  // Section creation start/end coordinates in [lng, lat] format
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
  // 3D is this map tilted over the elevation model: the same sources, layers and taps, with pitch
  // and rotate gestures while it is on. A page with no elevation tiles says so and the map lies
  // flat again. A camera the athlete chose is never turned off a ridge that hides the line.
  const terrainOn = is3DMode && hasRoute;
  const terrainPitch = initial3DCamera?.pitch ?? TERRAIN_3D_CONFIG.defaultPitch;
  const terrainPinned = !!initial3DCamera && initial3DCameraPinned === true;
  const terrain = useMemo((): MapTerrainSpec | null => {
    if (!terrainOn) return null;
    return {
      exaggeration: TERRAIN_3D_CONFIG.defaultExaggeration,
      pitch: terrainPitch,
      subjectSource: 'route',
      cameraPinned: terrainPinned,
    };
  }, [terrainOn, terrainPitch, terrainPinned]);
  const is3DLoading = terrainOn && !surfaceReady;
  const detailLayers = useDetailLayers('activity', mapStyle, isDark, { terrain: terrainOn });
  // The fullscreen modal covers the hero, so its hidden column keeps its reserve and the hero text
  // does not reflow on the way back.
  const controlCount = activityMapControlCount({
    shown: showStyleToggle && bounds != null && validCoordinates.length > 0,
    hasGradientData,
    hasContextRows: detailLayers.rows.length > 0,
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
        coveredLeft,
        coveredRight: coveredRight + controlFootprint,
      }),
    [mapWidth, height, keyTop, coveredBottom, coveredLeft, coveredRight, controlFootprint]
  );

  // A sheet settle moves whichever surface is showing to the new frame.
  const { markMoved: markAthleteMoved } = useSettleCamera(fitPadding, surfaceRef, surfaceReady);
  useEffect(() => {
    markAthleteMovedRef.current = markAthleteMoved;
  }, [markAthleteMoved]);
  // The card's snapshot is drawn in the part the sheet leaves, where the surface will put the track.
  const posterFrame = useMemo(
    () => ({
      top: Math.max(0, fitPadding.top - TRACK_FIT_PADDING),
      right: Math.max(0, fitPadding.right - TRACK_FIT_PADDING),
      bottom: Math.max(0, fitPadding.bottom - TRACK_FIT_PADDING),
      left: Math.max(0, fitPadding.left - TRACK_FIT_PADDING),
    }),
    [fitPadding]
  );

  // The camera the page opens with, and the one a remount opens with after fullscreen: the
  // athlete's or the smart 3D camera in 3D, else where the surface was left, else the track fitted.
  const terrainCamera = useMemo((): MapCameraSpec | null => {
    if (!bounds || !initial3DCamera) return null;
    return terrainOpeningCamera(initial3DCamera, fitPadding, {
      bounds: { sw: bounds.sw, ne: bounds.ne },
      width: mapWidth,
      height,
    });
  }, [bounds, initial3DCamera, fitPadding, mapWidth, height]);
  const initialCamera = useMemo((): MapCameraSpec => {
    // With no track the view draws its placeholder and no surface.
    if (!bounds) return { center: [0, 0], zoom: 2 };
    if (camera2DOnHide) return camera2DOnHide;
    if (terrainOn && terrainCamera) return terrainCamera;
    return paddedFit({ sw: bounds.sw, ne: bounds.ne }, fitPadding);
  }, [bounds, camera2DOnHide, terrainOn, terrainCamera, fitPadding]);

  // Turning 3D on over a surface that is already up flies to the angle that was kept, as the
  // page opens at it when it is built in 3D.
  const terrainCameraRef = useRef(terrainCamera);
  terrainCameraRef.current = terrainCamera;
  const terrainWasOnRef = useRef(terrainOn);
  useEffect(() => {
    const entered = terrainOn && !terrainWasOnRef.current;
    terrainWasOnRef.current = terrainOn;
    if (entered && terrainCameraRef.current) {
      surfaceRef.current?.setCamera(terrainCameraRef.current, cameraMove.move);
    }
  }, [terrainOn, surfaceRef]);

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
      sectionMarkersGeoJSON,
      throttledHighlight,
      endpointsGeoJSON,
      sectionGeoJSON,
      sectionCreationMarkers,
      userLocationGeoJSON,
    ]
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
      terrain: terrainOn,
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
      terrainOn,
    ]
  );

  const specs = useMemo(
    () =>
      withContextLayers(
        activityMapSpecs({
          sources: sourceInput,
          layers: layerInput,
          coordinates: validCoordinates,
        }),
        detailLayers.context
      ),
    [sourceInput, layerInput, validCoordinates, detailLayers.context]
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

  // The camera an athlete's gesture leaves in 3D, which is what leaving 3D keeps. The surface
  // moves the camera itself too, for the tilt and a turn off a ridge, and those are not a gesture.
  const rememberGestureCamera = useCallback((state: MapCameraState, isUserInteraction: boolean) => {
    if (!isUserInteraction || !is3DModeRef.current) return;
    gestureCameraRef.current = {
      center: state.center,
      zoom: state.zoom,
      bearing: state.bearing,
      pitch: state.pitch,
    };
  }, []);

  const handleRegionChanging = useCallback(
    (state: MapCameraState, isUserInteraction: boolean) => {
      markAthleteMoved();
      rememberGestureCamera(state, isUserInteraction);
      handleRegionIsChanging(state);
    },
    [markAthleteMoved, rememberGestureCamera, handleRegionIsChanging]
  );

  // Compose camera region-did-change with attribution debounce
  const handleRegionDidChange = useCallback(
    (state: MapCameraState, isUserInteraction: boolean) => {
      handleCameraRegionDidChange(state);
      rememberGestureCamera(state, isUserInteraction);

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
    [handleCameraRegionDidChange, rememberGestureCamera, computeAttributionFromRefs]
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
            style={[styles.mapLayer, posterFrame]}
            resizeMode="cover"
          />
        ) : null}

        {/* The snapshot reads as a live map that ignores touch, so say the map is coming. It is
            centred in the part the sheet leaves and goes with the snapshot. */}
        {posterUri && is3DLoading ? (
          <View
            style={[styles.mapLayer, posterFrame, styles.loadingCue]}
            pointerEvents="none"
            testID={ACTIVITY_MAP_LOADING_CUE_TEST_ID}
          >
            <Spinner size="large" color={basePalette.route} label={t('maps.threeDLoading')} />
          </View>
        ) : null}

        {/* The map surface, flat or tilted over terrain. Unmounted, not hidden, whenever the
            fullscreen map is the one being looked at: a hidden WebView keeps its GL context and
            its tile textures, which is the whole cost of having it. */}
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
                initialCamera={initialCamera}
                sources={specs.sources}
                layers={specs.layers}
                images={specs.images}
                interactiveLayers={specs.interactiveLayers}
                terrain={terrain}
                released={!screenFocused}
                onMapReady={handleMapReady}
                onMapFailed={handleMapFailed}
                onPress={handleSurfacePress}
                onRegionIsChanging={handleRegionChanging}
                onRegionDidChange={handleRegionDidChange}
                onTerrainUnavailable={onTerrainUnavailable}
              />
            </View>
          </View>
        ) : null}

        {terrainNotice}

        {/* Attribution - uses ref-based updates to avoid map re-renders */}
        {showAttribution || isFullscreen ? (
          <AttributionOverlay
            sheetKey={sheetKey}
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
          nextStyle={nextMapStyle}
          onToggleStyle={toggleMapStyle}
          isDark={isDark}
          basePalette={basePalette}
          hasGradientData={hasGradientData}
          contextRows={detailLayers.rows}
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
