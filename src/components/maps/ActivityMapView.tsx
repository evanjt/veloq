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
 * **Trade-offs:**
 *
 * **Why WebView for 3D?**
 * - Pro: Mapbox GL JS has mature terrain visualization
 * - Pro: Faster to implement than native 3D solution
 * - Con: Additional memory footprint
 * - Con: Slower initial load
 *
 * **Why Animated.Value for 3D opacity?**
 * - Pro: Smooth crossfade (native driver)
 * - Con: Adds complexity to state management
 * - Alternative: CSS transitions (less control)
 *
 * **Why Section Creation State Machine?**
 * - Pro: Clear UX flow (start → end → confirm)
 * - Pro: Prevents invalid states
 * - Con: More complex than simple boolean
 *
 * **Component Size Note:**
 * At 861 lines, this component handles multiple concerns. Future refactoring
 * should consider extracting:
 * - StyleSwitcher component
 * - SectionCreationFlow component
 * - LocationHandler component
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
} from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  StatusBar,
  Animated,
  Text,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from "react-i18next";
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  MarkerView,
} from "@maplibre/maplibre-react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import {
  decodePolyline,
  LatLng,
  getActivityColor,
  getMapLibreBounds,
  getSectionStyle,
} from "@/lib";
import { colors, darkColors } from "@/theme/colors";
import { typography } from "@/theme/typography";
import { spacing, layout } from "@/theme/spacing";
import { shadows } from "@/theme/shadows";
import { useMapPreferences } from "@/providers";
import { BaseMapView } from "./BaseMapView";
import { Map3DWebView, type Map3DWebViewRef } from "./Map3DWebView";
import { CompassArrow } from "@/components/ui";
import {
  SectionCreationOverlay,
  type CreationState,
  type SectionCreationError,
} from "./SectionCreationOverlay";
import {
  type MapStyleType,
  getMapStyle,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
  MAP_ATTRIBUTIONS,
  TERRAIN_ATTRIBUTION,
  getCombinedSatelliteAttribution,
} from "./mapStyles";
import type { ActivityType, RoutePoint } from "@/types";

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
          style={[
            attributionStyles.attribution,
            isFullscreen && attributionStyles.attributionPill,
          ]}
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
    },
  ),
);

const attributionStyles = StyleSheet.create({
  attribution: {
    position: "absolute",
    bottom: 4,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 5,
  },
  attributionPill: {
    left: "auto",
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: spacing.sm,
  },
  attributionText: {
    fontSize: 9,
    color: "rgba(255, 255, 255, 0.5)",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  attributionTextPill: {
    color: colors.textSecondary,
    textShadowColor: "transparent",
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
}

/** Calculate distance between two coordinates using Haversine formula */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Re-export SectionCreationError for consumers
export type { SectionCreationError } from "./SectionCreationOverlay";

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
  /** Section ID to highlight (dims other sections when set) */
  highlightedSectionId?: string | null;
}

export const ActivityMapView = memo(function ActivityMapView({
  polyline: encodedPolyline,
  coordinates: providedCoordinates,
  activityType,
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
  highlightedSectionId,
}: ActivityMapViewProps) {
  const { t } = useTranslation();
  const { getStyleForActivity } = useMapPreferences();
  const preferredStyle = getStyleForActivity(activityType);
  const [mapStyle, setMapStyle] = useState<MapStyleType>(
    initialStyle ?? preferredStyle,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [is3DMode, setIs3DMode] = useState(false);
  const [is3DReady, setIs3DReady] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const map3DOpacity = useRef(new Animated.Value(0)).current;

  // Section creation state
  const [creationState, setCreationState] =
    useState<CreationState>("selectingStart");
  const [startIndex, setStartIndex] = useState<number | null>(null);
  const [endIndex, setEndIndex] = useState<number | null>(null);

  // Track if user manually overrode the style
  const [userOverride, setUserOverride] = useState(false);

  // iOS simulator tile loading retry mechanism
  const [mapKey, setMapKey] = useState(0);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  // Track when map is ready to receive camera commands
  const [mapReady, setMapReady] = useState(false);

  // DEBUG: Track render count
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const handleMapLoadError = useCallback(() => {
    if (Platform.OS === "ios" && retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current += 1;
      console.log(
        `[ActivityMap] Load failed, retrying (${retryCountRef.current}/${MAX_RETRIES})...`,
      );
      setMapReady(false); // Reset ready state before retry
      setTimeout(() => {
        setMapKey((k) => k + 1);
      }, RETRY_DELAY_MS * retryCountRef.current);
    }
  }, []);

  // Track pending initial bounds to apply on map load

  // Handle map finishing loading - now safe to apply camera commands
  // Also restore camera position if we saved one before style change
  const handleMapFinishLoading = useCallback(() => {
    if (__DEV__) {
      console.log("[ActivityMapView:Camera] handleMapFinishLoading called", {
        hasPendingRestore: !!pendingCameraRestoreRef.current,
        pendingCenter: pendingCameraRestoreRef.current?.center,
        pendingZoom: pendingCameraRestoreRef.current?.zoom,
      });
    }
    // Restore camera position after style change
    if (pendingCameraRestoreRef.current) {
      const { center, zoom } = pendingCameraRestoreRef.current;
      if (__DEV__) {
        console.log(
          "[ActivityMapView:Camera] RESTORING position via setCamera",
          { center, zoom },
        );
      }
      cameraRef.current?.setCamera({
        centerCoordinate: center,
        zoomLevel: zoom,
        animationDuration: 0,
        animationMode: "moveTo",
      });
      pendingCameraRestoreRef.current = null;
    }
    // Initial bounds are applied via effect when mapReady becomes true
    // Small delay to let camera settle before showing map
    if (__DEV__) {
      console.log("[ActivityMapView:Camera] Setting mapReady=true in 50ms");
    }
    setTimeout(() => setMapReady(true), 50);
  }, []);

  // Track if we need to restore camera after style change
  const pendingCameraRestoreRef = useRef<{
    center: [number, number];
    zoom: number;
  } | null>(null);

  // Track if this is the initial mount (used to skip position save on first render)
  const isInitialMountRef = useRef(true);

  // Reset retry count, map ready state when style changes (map reloads)
  // Save current camera position to restore after reload (only if we have a position)
  useEffect(() => {
    if (__DEV__) {
      console.log("[ActivityMapView:Camera] Style/Key change effect", {
        mapStyle,
        mapKey,
        isInitialMount: isInitialMountRef.current,
        currentCenter: currentCenterRef.current,
        currentZoom: currentZoomRef.current,
      });
    }
    retryCountRef.current = 0;

    // On style change (not initial mount), save current position for restoration
    // This preserves user's zoom/pan when switching map styles
    if (
      !isInitialMountRef.current &&
      currentCenterRef.current &&
      currentZoomRef.current
    ) {
      pendingCameraRestoreRef.current = {
        center: currentCenterRef.current,
        zoom: currentZoomRef.current,
      };
      if (__DEV__) {
        console.log(
          "[ActivityMapView:Camera] Saved position for restore",
          pendingCameraRestoreRef.current,
        );
      }
    }

    // Mark initial mount as done after first effect run
    isInitialMountRef.current = false;
    if (__DEV__) {
      console.log("[ActivityMapView:Camera] Setting mapReady=false");
    }
    setMapReady(false);
  }, [mapStyle, mapKey]);

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

  // Update map style when preference changes (unless user manually toggled)
  useEffect(() => {
    if (!userOverride && !initialStyle && mapStyle !== preferredStyle) {
      setMapStyle(preferredStyle);
    }
  }, [userOverride, initialStyle, mapStyle, preferredStyle]);

  // Track previous external creation state to detect transitions
  const prevExternalCreationStateRef = useRef<CreationState | undefined>(
    externalCreationState,
  );

  // Reset section creation state when mode changes
  useEffect(() => {
    if (__DEV__) {
      console.log("[ActivityMapView:Camera] creationMode effect", {
        creationMode,
        renderCount: renderCountRef.current,
      });
    }
    if (creationMode) {
      setCreationState("selectingStart");
      setStartIndex(null);
      setEndIndex(null);
    }
  }, [creationMode]);

  // Reset internal state ONLY when transitioning from 'error' to undefined (user clicked retry)
  // Do NOT reset when transitioning from 'creating' to undefined (success path)
  useEffect(() => {
    const wasError = prevExternalCreationStateRef.current === "error";
    const nowUndefined = externalCreationState === undefined;

    if (creationMode && wasError && nowUndefined) {
      // External error state was cleared (user dismissed error), reset to allow new selection
      if (__DEV__) {
        console.log(
          "[ActivityMapView] Resetting selection after error dismissal",
        );
      }
      setCreationState("selectingStart");
      setStartIndex(null);
      setEndIndex(null);
    }

    // Track previous state for next render
    prevExternalCreationStateRef.current = externalCreationState;
  }, [creationMode, externalCreationState]);

  const toggleMapStyle = useCallback(() => {
    setUserOverride(true);
    setMapStyle((current) => getNextStyle(current));
  }, []);

  // Toggle 3D mode
  const toggle3D = useCallback(() => {
    setIs3DMode((current) => !current);
  }, []);

  // Notify parent when 3D mode changes (outside of render cycle)
  useEffect(() => {
    on3DModeChange?.(is3DMode);
  }, [is3DMode, on3DModeChange]);

  // Notify parent when map style changes (for external attribution display)
  useEffect(() => {
    onStyleChange?.(mapStyle);
  }, [mapStyle, onStyleChange]);

  // Reset 3D ready state when toggling off
  useEffect(() => {
    if (!is3DMode) {
      setIs3DReady(false);
      map3DOpacity.setValue(0);
    }
  }, [is3DMode, map3DOpacity]);

  // Handle 3D map ready
  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    Animated.timing(map3DOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [map3DOpacity]);

  // Get user location and refocus camera
  const handleGetLocation = useCallback(async () => {
    try {
      setLocationLoading(true);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationLoading(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords: [number, number] = [
        location.coords.longitude,
        location.coords.latitude,
      ];
      setLocationLoading(false);

      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 14,
        animationDuration: 500,
      });
    } catch {
      setLocationLoading(false);
      // Silently fail
    }
  }, []);

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
  const handleMapPress = useCallback(
    (feature: GeoJSON.Feature) => {
      if (__DEV__) {
        console.log("[ActivityMapView:Camera] handleMapPress", {
          creationMode,
          creationState,
          featureType: feature?.geometry?.type,
        });
      }
      // In creation mode, handle point selection
      if (creationMode && feature?.geometry?.type === "Point") {
        const [lng, lat] = feature.geometry.coordinates as [number, number];

        // Find nearest point on the route
        if (validCoordinates.length === 0) return;

        let nearestIndex = 0;
        let nearestDistance = Infinity;

        for (let i = 0; i < validCoordinates.length; i++) {
          const coord = validCoordinates[i];
          const dx = coord.longitude - lng;
          const dy = coord.latitude - lat;
          const dist = dx * dx + dy * dy;
          if (dist < nearestDistance) {
            nearestDistance = dist;
            nearestIndex = i;
          }
        }

        if (creationState === "selectingStart") {
          if (__DEV__) {
            console.log("[ActivityMapView:Camera] Setting startIndex", {
              nearestIndex,
            });
          }
          setStartIndex(nearestIndex);
          setCreationState("selectingEnd");
        } else if (creationState === "selectingEnd") {
          // Ensure end is after start
          if (nearestIndex <= (startIndex ?? 0)) {
            // Swap them
            if (__DEV__) {
              console.log("[ActivityMapView:Camera] Swapping start/end", {
                nearestIndex,
                startIndex,
              });
            }
            setEndIndex(startIndex);
            setStartIndex(nearestIndex);
          } else {
            if (__DEV__) {
              console.log("[ActivityMapView:Camera] Setting endIndex", {
                nearestIndex,
              });
            }
            setEndIndex(nearestIndex);
          }
          setCreationState("complete");
        }
        return;
      }

      if (enableFullscreen) {
        openFullscreen();
      }
    },
    [
      enableFullscreen,
      openFullscreen,
      creationMode,
      creationState,
      startIndex,
      validCoordinates,
    ],
  );

  // iOS tap handler - converts screen coordinates to map coordinates
  // MapView.onPress doesn't fire reliably on iOS with Fabric architecture
  const handleiOSTap = useCallback(
    async (screenX: number, screenY: number) => {
      if (!mapRef.current) return;

      try {
        // Convert screen coordinates to map coordinates [lng, lat]
        const coords = await mapRef.current.getCoordinateFromView([
          screenX,
          screenY,
        ]);
        if (!coords || coords.length < 2) return;

        // Create a GeoJSON feature and call handleMapPress
        const feature: GeoJSON.Feature = {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: coords,
          },
        };

        handleMapPress(feature);
      } catch {
        // Silently fail - tap handling is best effort
      }
    },
    [handleMapPress],
  );

  // Section creation handlers
  const handleCreationConfirm = useCallback(() => {
    if (startIndex === null || endIndex === null) return;

    // Extract section polyline
    const sectionCoords = validCoordinates.slice(startIndex, endIndex + 1);
    const polyline: RoutePoint[] = sectionCoords.map((c) => ({
      lat: c.latitude,
      lng: c.longitude,
    }));

    // Calculate distance using Haversine
    let distance = 0;
    for (let i = 1; i < sectionCoords.length; i++) {
      const prev = sectionCoords[i - 1];
      const curr = sectionCoords[i];
      distance += haversineDistance(
        prev.latitude,
        prev.longitude,
        curr.latitude,
        curr.longitude,
      );
    }

    onSectionCreated?.({
      polyline,
      startIndex,
      endIndex,
      distanceMeters: distance,
    });

    // Reset state
    setCreationState("selectingStart");
    setStartIndex(null);
    setEndIndex(null);
  }, [startIndex, endIndex, validCoordinates, onSectionCreated]);

  const handleCreationCancel = useCallback(() => {
    setCreationState("selectingStart");
    setStartIndex(null);
    setEndIndex(null);
    onCreationCancelled?.();
  }, [onCreationCancelled]);

  const handleCreationReset = useCallback(() => {
    setCreationState("selectingStart");
    setStartIndex(null);
    setEndIndex(null);
  }, []);

  // Compass bearing state
  const bearingAnim = useRef(new Animated.Value(0)).current;

  // Handle 3D map bearing changes (for compass sync)
  const handleBearingChange = useCallback(
    (bearing: number) => {
      bearingAnim.setValue(-bearing);
    },
    [bearingAnim],
  );

  // Handle map region change to update compass
  const handleRegionIsChanging = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as { heading?: number } | undefined;
      if (properties?.heading !== undefined) {
        bearingAnim.setValue(-properties.heading);
      }
    },
    [bearingAnim],
  );

  // Camera ref for programmatic control
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);

  // Map ref for getCoordinateFromView (iOS tap handling)
  const mapRef = useRef<React.ElementRef<typeof MapView>>(null);

  // Track touch start for iOS tap detection (MapView.onPress doesn't fire on iOS with Fabric)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(
    null,
  );

  // Reset bearing to north
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
  }, [bearingAnim, is3DMode, is3DReady]);

  const bounds = useMemo(
    () => getMapLibreBounds(validCoordinates),
    [validCoordinates],
  );

  // Track if initial camera position has been applied (prevents re-centering on re-renders)
  // This is the key to preventing the camera from snapping back when entering creation mode
  const initialCameraAppliedRef = useRef(false);

  // DEBUG: Log render with key state
  if (__DEV__) {
    console.log("[ActivityMapView] RENDER #" + renderCountRef.current, {
      mapReady,
      creationMode,
      creationState,
      startIndex,
      endIndex,
      mapKey,
      mapStyle,
      coordCount: validCoordinates.length,
      initialCameraApplied: initialCameraAppliedRef.current,
    });
  }

  // Apply initial bounds ONCE via imperative setCamera - no declarative props
  // This avoids MapLibre's re-render behavior that can reset camera position
  useEffect(() => {
    if (__DEV__) {
      console.log("[ActivityMapView:Camera] Initial bounds effect check", {
        alreadyApplied: initialCameraAppliedRef.current,
        mapReady,
        hasBounds: !!bounds,
        hasCameraRef: !!cameraRef.current,
      });
    }
    if (initialCameraAppliedRef.current) {
      if (__DEV__) {
        console.log("[ActivityMapView:Camera] Skipping - already applied");
      }
      return;
    }
    if (mapReady && bounds && cameraRef.current) {
      if (__DEV__) {
        console.log(
          "[ActivityMapView:Camera] APPLYING initial bounds via setCamera",
          bounds,
        );
      }
      cameraRef.current.setCamera({
        bounds: { ne: bounds.ne, sw: bounds.sw },
        padding: {
          paddingTop: 50,
          paddingRight: 50,
          paddingBottom: 50,
          paddingLeft: 50,
        },
        animationDuration: 0,
        animationMode: "moveTo",
      });
      initialCameraAppliedRef.current = true;
    }
  }, [mapReady, bounds]);

  // GeoJSON LineString requires minimum 2 coordinates - invalid data causes iOS crash:
  // -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207)
  // CRITICAL: Always return valid GeoJSON to avoid add/remove cycles that crash iOS MapLibre
  const routeGeoJSON = useMemo(():
    | GeoJSON.FeatureCollection
    | GeoJSON.Feature => {
    if (validCoordinates.length < 2) {
      if (__DEV__) {
        console.warn(
          `[ActivityMapView] routeGeoJSON: insufficient coordinates (${validCoordinates.length})`,
        );
      }
      return { type: "FeatureCollection" as const, features: [] };
    }
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: validCoordinates.map((c) => [c.longitude, c.latitude]),
      },
    };
  }, [validCoordinates]);

  const routeHasData =
    routeGeoJSON.type === "Feature" ||
    (routeGeoJSON.type === "FeatureCollection" &&
      routeGeoJSON.features.length > 0);

  // Route overlay GeoJSON (for showing matched route trace)
  // CRITICAL: Always return a valid GeoJSON to avoid add/remove cycles that crash iOS MapLibre
  // When there's no data, return an empty FeatureCollection instead of null
  const overlayGeoJSON = useMemo(():
    | GeoJSON.FeatureCollection
    | GeoJSON.Feature => {
    if (!routeOverlay || routeOverlay.length < 2) {
      return { type: "FeatureCollection" as const, features: [] };
    }
    const validOverlay = routeOverlay.filter(
      (c) => !isNaN(c.latitude) && !isNaN(c.longitude),
    );
    if (validOverlay.length < 2) {
      return { type: "FeatureCollection" as const, features: [] };
    }
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: validOverlay.map((c) => [c.longitude, c.latitude]),
      },
    };
  }, [routeOverlay]);

  // Helper to check if overlay has data (for logging)
  const overlayHasData =
    overlayGeoJSON.type === "Feature" ||
    (overlayGeoJSON.type === "FeatureCollection" &&
      overlayGeoJSON.features.length > 0);

  // Section overlays GeoJSON (for showing all matched sections)
  // CRITICAL: Returns both sectionOverlaysGeoJSON (for markers) and consolidated GeoJSONs (for rendering)
  // The consolidated GeoJSONs always have valid geometry to prevent Fabric add/remove crashes
  const {
    sectionOverlaysGeoJSON,
    consolidatedSectionsGeoJSON,
    consolidatedPortionsGeoJSON,
  } = useMemo(() => {
    // Minimal valid geometry for when there are no overlays
    const minimalLine: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { _placeholder: true },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [0, 0.0001],
            ],
          },
        },
      ],
    };

    if (!sectionOverlays || sectionOverlays.length === 0) {
      return {
        sectionOverlaysGeoJSON: null,
        consolidatedSectionsGeoJSON: minimalLine,
        consolidatedPortionsGeoJSON: minimalLine,
      };
    }

    let skippedSections = 0;
    let skippedPortions = 0;
    const sectionFeatures: GeoJSON.Feature[] = [];
    const portionFeatures: GeoJSON.Feature[] = [];
    const overlayData: Array<{
      id: string;
      sectionGeo: GeoJSON.Feature | null;
      portionGeo: GeoJSON.Feature | null;
    }> = [];

    sectionOverlays.forEach((overlay) => {
      // Build section polyline GeoJSON - also filter Infinity values
      const validSectionPoints = overlay.sectionPolyline.filter(
        (c) =>
          Number.isFinite(c.latitude) &&
          Number.isFinite(c.longitude) &&
          !isNaN(c.latitude) &&
          !isNaN(c.longitude),
      );

      let sectionGeo: GeoJSON.Feature | null = null;
      if (validSectionPoints.length >= 2) {
        sectionGeo = {
          type: "Feature",
          properties: { id: overlay.id, type: "section" },
          geometry: {
            type: "LineString",
            coordinates: validSectionPoints.map((c) => [
              c.longitude,
              c.latitude,
            ]),
          },
        };
        sectionFeatures.push(sectionGeo);
      } else if (overlay.sectionPolyline.length > 0) {
        skippedSections++;
        if (__DEV__) {
          console.warn(
            `[ActivityMapView] INVALID SECTION OVERLAY: id=${overlay.id} originalPoints=${overlay.sectionPolyline.length} validPoints=${validSectionPoints.length}`,
          );
        }
      }

      // Build activity portion GeoJSON - also filter Infinity values
      const validPortionPoints = overlay.activityPortion?.filter(
        (c) =>
          Number.isFinite(c.latitude) &&
          Number.isFinite(c.longitude) &&
          !isNaN(c.latitude) &&
          !isNaN(c.longitude),
      );

      let portionGeo: GeoJSON.Feature | null = null;
      if (validPortionPoints && validPortionPoints.length >= 2) {
        portionGeo = {
          type: "Feature",
          properties: { id: overlay.id, type: "portion" },
          geometry: {
            type: "LineString",
            coordinates: validPortionPoints.map((c) => [
              c.longitude,
              c.latitude,
            ]),
          },
        };
        portionFeatures.push(portionGeo);
      } else if (
        overlay.activityPortion &&
        overlay.activityPortion.length > 0
      ) {
        skippedPortions++;
        if (__DEV__) {
          console.warn(
            `[ActivityMapView] INVALID PORTION OVERLAY: id=${overlay.id} originalPoints=${overlay.activityPortion.length} validPoints=${validPortionPoints?.length ?? 0}`,
          );
        }
      }

      // iOS CRASH FIX: Always push to maintain stable child count
      // MapLibre Fabric crashes when child count changes between renders
      // Rendering handles invalid markers with opacity: 0
      overlayData.push({ id: overlay.id, sectionGeo, portionGeo });
    });

    if (__DEV__ && (skippedSections > 0 || skippedPortions > 0)) {
      console.warn(
        `[ActivityMapView] sectionOverlaysGeoJSON: skipped ${skippedSections} sections, ${skippedPortions} portions with invalid polylines`,
      );
    }

    return {
      sectionOverlaysGeoJSON: overlayData.length > 0 ? overlayData : null,
      consolidatedSectionsGeoJSON:
        sectionFeatures.length > 0
          ? { type: "FeatureCollection" as const, features: sectionFeatures }
          : minimalLine,
      consolidatedPortionsGeoJSON:
        portionFeatures.length > 0
          ? { type: "FeatureCollection" as const, features: portionFeatures }
          : minimalLine,
    };
  }, [sectionOverlays]);

  // Route coordinates for BaseMapView/Map3DWebView [lng, lat] format
  const routeCoords = useMemo(() => {
    return validCoordinates.map(
      (c) => [c.longitude, c.latitude] as [number, number],
    );
  }, [validCoordinates]);

  const activityColor = getActivityColor(activityType);
  const startPoint = validCoordinates[0];
  const endPoint = validCoordinates[validCoordinates.length - 1];

  // Get the highlighted point from elevation chart selection
  const highlightPoint = useMemo(() => {
    if (
      highlightIndex != null &&
      highlightIndex >= 0 &&
      highlightIndex < coordinates.length
    ) {
      const coord = coordinates[highlightIndex];
      if (coord && !isNaN(coord.latitude) && !isNaN(coord.longitude)) {
        return coord;
      }
    }
    return null;
  }, [highlightIndex, coordinates]);

  // Section creation: calculate section distance
  const sectionDistance = useMemo(() => {
    if (!creationMode || startIndex === null || endIndex === null) return null;
    const sectionCoords = validCoordinates.slice(startIndex, endIndex + 1);
    let distance = 0;
    for (let i = 1; i < sectionCoords.length; i++) {
      const prev = sectionCoords[i - 1];
      const curr = sectionCoords[i];
      distance += haversineDistance(
        prev.latitude,
        prev.longitude,
        curr.latitude,
        curr.longitude,
      );
    }
    return distance;
  }, [creationMode, startIndex, endIndex, validCoordinates]);

  // Section creation: calculate point count for UI feedback
  const sectionPointCount = useMemo(() => {
    if (!creationMode || startIndex === null || endIndex === null) return null;
    return endIndex - startIndex + 1;
  }, [creationMode, startIndex, endIndex]);

  // Section creation: GeoJSON for selected portion
  // CRITICAL: Always return valid GeoJSON to avoid add/remove cycles that crash iOS MapLibre
  const sectionGeoJSON = useMemo(():
    | GeoJSON.FeatureCollection
    | GeoJSON.Feature => {
    if (!creationMode || startIndex === null) {
      return { type: "FeatureCollection" as const, features: [] };
    }
    const end = endIndex ?? startIndex;
    const sectionCoords = validCoordinates.slice(startIndex, end + 1);
    if (sectionCoords.length < 2) {
      return { type: "FeatureCollection" as const, features: [] };
    }
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: sectionCoords.map((c) => [c.longitude, c.latitude]),
      },
    };
  }, [creationMode, startIndex, endIndex, validCoordinates]);

  const sectionHasData =
    sectionGeoJSON.type === "Feature" ||
    (sectionGeoJSON.type === "FeatureCollection" &&
      sectionGeoJSON.features.length > 0);

  // Section creation: get selected start/end points for markers
  const sectionStartPoint =
    creationMode && startIndex !== null ? validCoordinates[startIndex] : null;
  const sectionEndPoint =
    creationMode && endIndex !== null ? validCoordinates[endIndex] : null;

  const mapStyleValue = getMapStyle(mapStyle);
  const isDark = isDarkStyle(mapStyle);

  // Track current map viewport for dynamic attribution using refs to avoid re-renders during gestures
  // Initialize center from bounds if available (prevents camera jump on first render)
  const boundsCenter = useMemo((): [number, number] | null => {
    if (!bounds) return null;
    const centerLng = (bounds.ne[0] + bounds.sw[0]) / 2;
    const centerLat = (bounds.ne[1] + bounds.sw[1]) / 2;
    return [centerLng, centerLat];
  }, [bounds]);

  const currentCenterRef = useRef<[number, number] | null>(boundsCenter);
  const currentZoomRef = useRef(14); // Start at reasonable zoom, will be updated by onRegionDidChange

  // Update ref initial value if bounds becomes available after mount
  if (boundsCenter && !currentCenterRef.current) {
    currentCenterRef.current = boundsCenter;
  }

  // DEBUG: Log camera ref values
  if (__DEV__) {
    console.log("[ActivityMapView:Camera] Camera ref values", {
      center: currentCenterRef.current,
      zoom: currentZoomRef.current,
      boundsCenter,
    });
  }
  const attributionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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

    if (style === "satellite" && center) {
      const satAttribution = getCombinedSatelliteAttribution(
        center[1], // lat
        center[0], // lng
        zoom,
      );
      return is3D
        ? `${satAttribution} | ${TERRAIN_ATTRIBUTION}`
        : satAttribution;
    }
    const baseAttribution = MAP_ATTRIBUTIONS[style];
    return is3D
      ? `${baseAttribution} | ${TERRAIN_ATTRIBUTION}`
      : baseAttribution;
  }, []);

  // Handle region change end - update refs only, debounce attribution callback
  const handleRegionDidChange = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as
        | {
            zoomLevel?: number;
            visibleBounds?: [[number, number], [number, number]];
          }
        | undefined;
      const { zoomLevel, visibleBounds } = properties ?? {};

      if (zoomLevel !== undefined) {
        currentZoomRef.current = zoomLevel;
      }

      // v10: center is from feature.geometry.coordinates [lng, lat]
      // v10: visibleBounds is [[swLng, swLat], [neLng, neLat]]
      if (feature.geometry?.type === "Point") {
        currentCenterRef.current = feature.geometry.coordinates as [
          number,
          number,
        ];
      } else if (visibleBounds) {
        const [[swLng, swLat], [neLng, neLat]] = visibleBounds;
        const centerLng = (swLng + neLng) / 2;
        const centerLat = (swLat + neLat) / 2;
        currentCenterRef.current = [centerLng, centerLat];
      }

      // DEBUG: Log significant zoom changes (to track camera resets)
      if (__DEV__ && zoomLevel !== undefined) {
        console.log("[ActivityMapView:Camera] onRegionDidChange", {
          zoomLevel: zoomLevel.toFixed(2),
          center: currentCenterRef.current,
        });
      }

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
    [computeAttributionFromRefs],
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
        <MaterialCommunityIcons
          name="map-marker-off"
          size={48}
          color={colors.textSecondary}
        />
      </View>
    );
  }

  const hasRoute = routeCoords.length > 0;

  return (
    <View style={[styles.outerContainer, { height }]}>
      <View
        style={styles.container}
        onTouchStart={
          Platform.OS === "ios"
            ? (e) => {
                touchStartRef.current = {
                  x: e.nativeEvent.locationX,
                  y: e.nativeEvent.locationY,
                  time: Date.now(),
                };
              }
            : undefined
        }
        onTouchEnd={
          Platform.OS === "ios"
            ? (e) => {
                const start = touchStartRef.current;
                if (!start) return;

                const dx = Math.abs(e.nativeEvent.locationX - start.x);
                const dy = Math.abs(e.nativeEvent.locationY - start.y);
                const duration = Date.now() - start.time;

                // Only treat as tap if: short duration, minimal movement
                const isTap = duration < 300 && dx < 10 && dy < 10;
                // Don't handle taps in fullscreen or 3D mode
                const shouldHandle = !isFullscreen && !(is3DMode && is3DReady);

                if (isTap && shouldHandle) {
                  handleiOSTap(
                    e.nativeEvent.locationX,
                    e.nativeEvent.locationY,
                  );
                }
                touchStartRef.current = null;
              }
            : undefined
        }
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
            onPress={Platform.OS === "android" ? handleMapPress : undefined}
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
                  lineColor: "#00E5FF",
                  lineWidth: 5,
                  lineCap: "round",
                  lineJoin: "round",
                  lineOpacity: 0.5,
                }}
              />
            </ShapeSource>

            {/* Route line - render first so section overlays appear on top */}
            {/* CRITICAL: Always render ShapeSource to avoid add/remove cycles that crash iOS MapLibre */}
            <ShapeSource id="routeSource" shape={routeGeoJSON}>
              <LineLayer
                id="routeLine"
                style={{
                  lineColor: activityColor,
                  lineWidth: 4,
                  lineCap: "round",
                  lineJoin: "round",
                  lineOpacity: sectionOverlaysGeoJSON
                    ? 0.8
                    : overlayHasData
                      ? 0.85
                      : 1,
                }}
              />
            </ShapeSource>

            {/* Section overlays - render after route line so they appear on top */}
            {/* CRITICAL: Always render stable ShapeSources to avoid Fabric crash */}
            {/* Using consolidated GeoJSONs prevents add/remove cycles during state changes */}
            <ShapeSource
              id="section-overlays-consolidated"
              shape={consolidatedSectionsGeoJSON}
            >
              <LineLayer
                id="section-overlays-line"
                style={{
                  lineColor: highlightedSectionId
                    ? [
                        "case",
                        ["==", ["get", "id"], highlightedSectionId],
                        "#F59E0B",
                        "#DC2626",
                      ]
                    : "#DC2626",
                  lineWidth: highlightedSectionId
                    ? [
                        "case",
                        ["==", ["get", "id"], highlightedSectionId],
                        5,
                        6,
                      ]
                    : 6,
                  lineCap: "round",
                  lineJoin: "round",
                  lineOpacity: sectionOverlaysGeoJSON
                    ? highlightedSectionId
                      ? [
                          "case",
                          ["==", ["get", "id"], highlightedSectionId],
                          0.5,
                          0.3,
                        ]
                      : 0.8
                    : 0,
                }}
              />
            </ShapeSource>
            <ShapeSource
              id="portion-overlays-consolidated"
              shape={consolidatedPortionsGeoJSON}
            >
              <LineLayer
                id="portion-overlays-line"
                style={{
                  lineColor: highlightedSectionId
                    ? [
                        "case",
                        ["==", ["get", "id"], highlightedSectionId],
                        "#F59E0B",
                        "#DC2626",
                      ]
                    : "#DC2626",
                  lineWidth: highlightedSectionId
                    ? [
                        "case",
                        ["==", ["get", "id"], highlightedSectionId],
                        4,
                        4,
                      ]
                    : 4,
                  lineCap: "round",
                  lineJoin: "round",
                  lineOpacity: sectionOverlaysGeoJSON
                    ? highlightedSectionId
                      ? [
                          "case",
                          ["==", ["get", "id"], highlightedSectionId],
                          0.6,
                          0.3,
                        ]
                      : 1
                    : 0,
                }}
              />
            </ShapeSource>

            {/* Start marker */}
            {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
            <MarkerView
              coordinate={
                startPoint
                  ? [startPoint.longitude, startPoint.latitude]
                  : [0, 0]
              }
            >
              <View
                style={[
                  styles.markerContainer,
                  { opacity: startPoint ? 1 : 0 },
                ]}
              >
                <View style={[styles.marker, styles.startMarker]}>
                  <MaterialCommunityIcons
                    name="play"
                    size={14}
                    color={colors.textOnDark}
                  />
                </View>
              </View>
            </MarkerView>

            {/* End marker */}
            {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
            <MarkerView
              coordinate={
                endPoint ? [endPoint.longitude, endPoint.latitude] : [0, 0]
              }
            >
              <View
                style={[styles.markerContainer, { opacity: endPoint ? 1 : 0 }]}
              >
                <View style={[styles.marker, styles.endMarker]}>
                  <MaterialCommunityIcons
                    name="flag-checkered"
                    size={14}
                    color={colors.textOnDark}
                  />
                </View>
              </View>
            </MarkerView>

            {/* Highlight marker from elevation chart */}
            {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
            {/* Key includes highlightIndex to force position update (stable when null) */}
            <MarkerView
              key={`highlight-${highlightIndex ?? "none"}`}
              coordinate={
                highlightPoint
                  ? [highlightPoint.longitude, highlightPoint.latitude]
                  : [0, 0]
              }
            >
              <View
                style={[
                  styles.markerContainer,
                  { opacity: highlightPoint ? 1 : 0 },
                ]}
              >
                <View style={styles.highlightMarker}>
                  <View style={styles.highlightMarkerInner} />
                </View>
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
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            </ShapeSource>

            {/* Section creation: start marker */}
            {/* CRITICAL: Always render to avoid camera reset when marker appears */}
            {/* Use activity start as fallback to stay within map bounds (not [0,0]) */}
            {/* Key includes startIndex to force position update (stable when null) */}
            <MarkerView
              key={`section-start-${startIndex ?? "none"}`}
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
                <View style={[styles.marker, styles.sectionStartMarker]}>
                  <MaterialCommunityIcons
                    name="flag-outline"
                    size={14}
                    color={colors.textOnDark}
                  />
                </View>
              </View>
            </MarkerView>

            {/* Section creation: end marker */}
            {/* CRITICAL: Always render to avoid camera reset when marker appears */}
            {/* Use activity end as fallback to stay within map bounds (not [0,0]) */}
            {/* Key includes endIndex to force position update (stable when null) */}
            <MarkerView
              key={`section-end-${endIndex ?? "none"}`}
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
                <View style={[styles.marker, styles.sectionEndMarker]}>
                  <MaterialCommunityIcons
                    name="flag"
                    size={14}
                    color={colors.textOnDark}
                  />
                </View>
              </View>
            </MarkerView>

            {/* Numbered markers at center of each section, offset to the side */}
            {/* CRITICAL: Always render ALL markers - never return null to avoid iOS Fabric crash */}
            {/* iOS crash: -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207) */}
            {sectionOverlaysGeoJSON &&
              sectionOverlaysGeoJSON.map((overlay, index) => {
                // Get coordinates from sectionGeo or portionGeo (both are LineString)
                const sectionGeom = overlay.sectionGeo?.geometry as
                  | GeoJSON.LineString
                  | undefined;
                const portionGeom = overlay.portionGeo?.geometry as
                  | GeoJSON.LineString
                  | undefined;
                const coords =
                  sectionGeom?.coordinates || portionGeom?.coordinates;
                const hasValidCoords = coords && coords.length >= 2;

                // Calculate marker position only if we have valid coords
                let markerLng = 0;
                let markerLat = 0;
                let hasValidMarkerPosition = false;

                if (hasValidCoords) {
                  // Use midpoint of the trace
                  const midIndex = Math.floor(coords.length / 2);
                  const midCoord = coords[midIndex];
                  if (
                    midCoord &&
                    typeof midCoord[0] === "number" &&
                    typeof midCoord[1] === "number" &&
                    Number.isFinite(midCoord[0]) &&
                    Number.isFinite(midCoord[1])
                  ) {
                    // Calculate perpendicular offset from trace direction
                    const prevIndex = Math.max(0, midIndex - 1);
                    const nextIndex = Math.min(coords.length - 1, midIndex + 1);
                    const prevCoord = coords[prevIndex];
                    const nextCoord = coords[nextIndex];

                    // Direction vector along the trace
                    const dx = nextCoord[0] - prevCoord[0];
                    const dy = nextCoord[1] - prevCoord[1];
                    const len = Math.sqrt(dx * dx + dy * dy);

                    // Perpendicular offset (to the right of travel direction)
                    const offsetDistance = 0.00035; // ~35 meters at equator
                    const offsetLng =
                      len > 0 ? (-dy / len) * offsetDistance : 0;
                    const offsetLat = len > 0 ? (dx / len) * offsetDistance : 0;

                    markerLng = midCoord[0] + offsetLng;
                    markerLat = midCoord[1] + offsetLat;
                    hasValidMarkerPosition =
                      Number.isFinite(markerLng) && Number.isFinite(markerLat);
                  }
                }

                const sectionStyle = getSectionStyle(index);
                const isHighlighted = highlightedSectionId === overlay.id;
                const isDimmed = highlightedSectionId && !isHighlighted;

                return (
                  <MarkerView
                    key={`sectionMarker-${overlay.id}`}
                    coordinate={[markerLng, markerLat]}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View
                      style={[
                        styles.sectionNumberMarker,
                        { borderColor: sectionStyle.color },
                        isDimmed && styles.sectionNumberMarkerDimmed,
                        isHighlighted && styles.sectionNumberMarkerHighlighted,
                        // Hide marker if position is invalid
                        !hasValidMarkerPosition && { opacity: 0 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.sectionNumberText,
                          isHighlighted && styles.sectionNumberTextHighlighted,
                        ]}
                      >
                        {index + 1}
                      </Text>
                    </View>
                  </MarkerView>
                );
              })}
          </MapView>
        </View>

        {/* 3D Map layer */}
        {is3DMode && hasRoute && !isFullscreen && (
          <Animated.View
            style={[
              styles.mapLayer,
              styles.map3DLayer,
              { opacity: map3DOpacity },
            ]}
          >
            <Map3DWebView
              ref={map3DRef}
              coordinates={routeCoords}
              mapStyle={mapStyle}
              routeColor={activityColor}
              onMapReady={handleMap3DReady}
              onBearingChange={handleBearingChange}
            />
          </Animated.View>
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
        {overlayGeoJSON && !isFullscreen && (
          <View style={styles.overlayLegend}>
            <View style={styles.legendRow}>
              <View
                style={[styles.legendLine, { backgroundColor: "#00E5FF" }]}
              />
              <Text style={styles.legendText}>{t("routes.legendRoute")}</Text>
            </View>
            <View style={styles.legendRow}>
              <View
                style={[styles.legendLine, { backgroundColor: activityColor }]}
              />
              <Text style={styles.legendText}>{t("routes.thisActivity")}</Text>
            </View>
          </View>
        )}

        {/* Section overlays legend */}
        {sectionOverlaysGeoJSON &&
          sectionOverlaysGeoJSON.length > 0 &&
          !isFullscreen && (
            <View style={styles.overlayLegend}>
              <View style={styles.legendRow}>
                <View
                  style={[styles.legendLine, { backgroundColor: "#00BCD4" }]}
                />
                <Text style={styles.legendText}>
                  {t("routes.legendSection")}
                </Text>
              </View>
              <View style={styles.legendRow}>
                <View
                  style={[styles.legendLine, { backgroundColor: "#E91E63" }]}
                />
                <Text style={styles.legendText}>
                  {t("routes.legendYourEffort")}
                </Text>
              </View>
              <View style={styles.legendRow}>
                <View
                  style={[
                    styles.legendLine,
                    { backgroundColor: activityColor },
                  ]}
                />
                <Text style={styles.legendText}>
                  {t("routes.legendFullActivity")}
                </Text>
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
        </View>
      )}

      {/* Fullscreen modal using BaseMapView */}
      <Modal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <BaseMapView
          routeCoordinates={routeCoords}
          routeColor={activityColor}
          bounds={bounds}
          initialStyle={mapStyle}
          onClose={closeFullscreen}
        >
          {/* Section overlays in fullscreen */}
          {/* CRITICAL: Always render stable ShapeSources to avoid Fabric crash */}
          <ShapeSource
            id="fs-section-overlays-consolidated"
            shape={consolidatedSectionsGeoJSON}
          >
            <LineLayer
              id="fs-section-overlays-line"
              style={{
                lineColor: "#DC2626",
                lineWidth: 6,
                lineCap: "round",
                lineJoin: "round",
                lineOpacity: sectionOverlaysGeoJSON ? 0.8 : 0,
              }}
            />
          </ShapeSource>
          <ShapeSource
            id="fs-portion-overlays-consolidated"
            shape={consolidatedPortionsGeoJSON}
          >
            <LineLayer
              id="fs-portion-overlays-line"
              style={{
                lineColor: "#DC2626",
                lineWidth: 4,
                lineCap: "round",
                lineJoin: "round",
                lineOpacity: sectionOverlaysGeoJSON ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* Numbered markers at center of each section in fullscreen */}
          {/* CRITICAL: Always render ALL markers - never return null to avoid iOS Fabric crash */}
          {/* iOS crash: -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207) */}
          {sectionOverlaysGeoJSON &&
            sectionOverlaysGeoJSON.map((overlay, index) => {
              const sectionGeom = overlay.sectionGeo?.geometry as
                | GeoJSON.LineString
                | undefined;
              const coords = sectionGeom?.coordinates;
              const hasValidCoords = coords && coords.length > 0;

              // Calculate center coordinate, default to [0,0] if invalid
              let centerLng = 0;
              let centerLat = 0;
              let hasValidCenter = false;

              if (hasValidCoords) {
                const midIndex = Math.floor(coords.length / 2);
                const centerCoord = coords[midIndex];
                if (
                  centerCoord &&
                  Number.isFinite(centerCoord[0]) &&
                  Number.isFinite(centerCoord[1])
                ) {
                  centerLng = centerCoord[0];
                  centerLat = centerCoord[1];
                  hasValidCenter = true;
                }
              }

              const style = getSectionStyle(index);

              return (
                <MarkerView
                  key={`fs-sectionMarker-${overlay.id}`}
                  coordinate={[centerLng, centerLat]}
                >
                  <View
                    style={[
                      styles.sectionNumberMarker,
                      { borderColor: style.color },
                      // Hide marker if position is invalid
                      !hasValidCenter && { opacity: 0 },
                    ]}
                  >
                    <Text style={styles.sectionNumberText}>{index + 1}</Text>
                  </View>
                </MarkerView>
              );
            })}

          {/* Start marker */}
          {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
          <MarkerView
            coordinate={
              startPoint ? [startPoint.longitude, startPoint.latitude] : [0, 0]
            }
          >
            <View
              style={[styles.markerContainer, { opacity: startPoint ? 1 : 0 }]}
            >
              <View style={[styles.marker, styles.startMarker]}>
                <MaterialCommunityIcons
                  name="play"
                  size={14}
                  color={colors.textOnDark}
                />
              </View>
            </View>
          </MarkerView>

          {/* End marker */}
          {/* CRITICAL: Always render to avoid Fabric crash - control visibility via opacity */}
          <MarkerView
            coordinate={
              endPoint ? [endPoint.longitude, endPoint.latitude] : [0, 0]
            }
          >
            <View
              style={[styles.markerContainer, { opacity: endPoint ? 1 : 0 }]}
            >
              <View style={[styles.marker, styles.endMarker]}>
                <MaterialCommunityIcons
                  name="flag-checkered"
                  size={14}
                  color={colors.textOnDark}
                />
              </View>
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
    position: "relative",
  },
  container: {
    flex: 1,
    borderRadius: layout.borderRadius,
    overflow: "hidden",
  },
  mapLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  map3DLayer: {
    zIndex: 1,
  },
  hiddenLayer: {
    opacity: 0,
    pointerEvents: "none",
  },
  map: {
    flex: 1,
  },
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: layout.borderRadius,
  },
  markerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  marker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: colors.textOnDark,
    ...shadows.elevated,
  },
  startMarker: {
    backgroundColor: colors.success,
  },
  endMarker: {
    backgroundColor: colors.error,
  },
  sectionStartMarker: {
    backgroundColor: "#00BCD4", // Cyan - distinct from activity start (green)
  },
  sectionEndMarker: {
    backgroundColor: "#9C27B0", // Purple - distinct from activity end (red)
  },
  highlightMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: colors.textOnDark,
    ...shadows.elevated,
  },
  highlightMarkerInner: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
    backgroundColor: colors.textOnDark,
  },
  controlsContainer: {
    position: "absolute",
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
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    justifyContent: "center",
    alignItems: "center",
    ...shadows.modal,
  },
  controlButtonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  controlButtonActive: {
    backgroundColor: colors.primary,
  },
  overlayLegend: {
    position: "absolute",
    bottom: spacing.sm + 36,
    right: spacing.sm,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: spacing.sm,
    zIndex: 10,
    gap: 4,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "500",
  },
  sectionNumberMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#1A1A1A",
    borderWidth: 2.5,
    borderColor: "#00BCD4",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  sectionNumberMarkerDimmed: {
    opacity: 0.2,
  },
  sectionNumberMarkerHighlighted: {
    backgroundColor: "#FFD700",
    borderColor: "#FF8C00",
    borderWidth: 3,
    transform: [{ scale: 1.2 }],
  },
  sectionNumberText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  sectionNumberTextHighlighted: {
    color: "#000000",
  },
});
