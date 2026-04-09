import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useTheme } from "@/hooks";
import {
  MapView,
  Camera,
  MarkerView,
  ShapeSource,
  LineLayer,
  CircleLayer,
  SymbolLayer,
  RasterSource,
  RasterLayer,
} from "@maplibre/maplibre-react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors, darkColors, spacing, layout, shadows } from "@/theme";
import { getActivityTypeConfig } from "./ActivityTypeFilter";
import { Map3DWebView, type Map3DWebViewRef } from "./Map3DWebView";
import { ComponentErrorBoundary } from "@/components/ui";
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
import type { ActivityBoundsItem } from "@/types";
import {
  useEngineSections,
  useRouteSignatures,
  useRouteGroups,
} from "@/hooks/routes";
import { HEATMAP_TILE_URL_TEMPLATE } from "@/hooks/maps/useHeatmapTiles";
import type { FrequentSection } from "@/types";
import {
  ActivityPopup,
  SectionPopup,
  RoutePopup,
  MapControlStack,
  useMapHandlers,
  useMapCamera,
  useMapGeoJSON,
  useIOSTapHandler,
  type SelectedActivity,
  type SelectedRoute,
  type SpiderState,
} from "./regional";
import { ROUTE_COLORS } from "@/lib/utils/constants";

/**
 * Generate spider layout GeoJSON for cluster fan-out at max zoom.
 * Places N points on a circle around the cluster center, with lines connecting
 * each point back to the center. Uses screen-space radius converted to map
 * coordinates based on zoom level.
 */
function buildSpiderGeoJSON(
  spider: SpiderState,
  zoom: number,
): { points: GeoJSON.FeatureCollection; lines: GeoJSON.FeatureCollection } {
  const { center, leaves } = spider;
  const n = leaves.length;

  // Convert ~40px screen radius to map degrees at current zoom
  // At zoom Z, 1 degree of longitude ≈ 256 * 2^Z / 360 pixels
  const pixelsPerDegree = (256 * Math.pow(2, zoom)) / 360;
  // Adjust for latitude (longitude degrees are narrower near poles)
  const latRadians = (center[1] * Math.PI) / 180;
  const lngScale = 1 / Math.cos(latRadians);
  const radiusPx = n <= 6 ? 40 : n <= 12 ? 55 : 70;
  const radiusDeg = radiusPx / pixelsPerDegree;

  const pointFeatures: GeoJSON.Feature[] = [];
  const lineFeatures: GeoJSON.Feature[] = [];

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start at top
    const dx = radiusDeg * Math.cos(angle) * lngScale;
    const dy = radiusDeg * Math.sin(angle);
    const spiderCoord: [number, number] = [center[0] + dx, center[1] + dy];

    const leaf = leaves[i];
    pointFeatures.push({
      type: "Feature",
      properties: {
        ...leaf.properties,
        isSpider: true,
      },
      geometry: {
        type: "Point",
        coordinates: spiderCoord,
      },
    });

    lineFeatures.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [center, spiderCoord],
      },
    });
  }

  return {
    points: { type: "FeatureCollection", features: pointFeatures },
    lines: { type: "FeatureCollection", features: lineFeatures },
  };
}

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * 120Hz OPTIMIZATION SUMMARY:
 *
 * This component has been optimized for smooth 120fps pan/zoom by:
 *
 * 1. Pre-computed centers: Activity centers are computed once in useMapCamera
 *    (using Rust-computed centers from RouteSignature when available),
 *    avoiding getBoundsCenter() format detection during render.
 *
 * 2. Stable GeoJSON: markersGeoJSON and tracesGeoJSON no longer depend on
 *    selection state. Instead, MapLibre expressions use selectedActivityId
 *    directly, preventing GeoJSON rebuilds on selection change.
 *
 * 3. Stable marker order: MarkerViews are rendered in stable order to avoid
 *    iOS crash (NSRangeException in MLRNMapView insertReactSubview:atIndex:).
 *
 * 4. Viewport culling: Uses spatial index (R-tree) to filter activities
 *    to only those in current viewport before rendering.
 */
interface RegionalMapViewProps {
  /** Activities to display */
  activities: ActivityBoundsItem[];
  /** Extra bottom offset for attribution (e.g., when timeline slider is shown) */
  attributionBottomOffset?: number;
  /** Show attribution (default: true) */
  showAttribution?: boolean;
  /** Callback when attribution text changes */
  onAttributionChange?: (attribution: string) => void;
}

export function RegionalMapView({
  activities,
  attributionBottomOffset = 0,
  showAttribution = true,
  onAttributionChange,
}: RegionalMapViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isDark: systemIsDark } = useTheme();
  const [showActivities, setShowActivities] = useState(true);
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = systemIsDark ? "dark" : "light";
  const [mapStyle, setMapStyle] = useState<MapStyleType>(systemStyle);
  const [selected, setSelected] = useState<SelectedActivity | null>(null);
  const [is3DMode, setIs3DMode] = useState(false);
  const [showSections, setShowSections] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(
    null,
  );
  const [locationLoading, setLocationLoading] = useState(false);
  const [visibleActivityIds, setVisibleActivityIds] =
    useState<Set<string> | null>(null);
  const [selectedSection, setSelectedSection] =
    useState<FrequentSection | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<SelectedRoute | null>(
    null,
  );
  const [spider, setSpider] = useState<SpiderState | null>(null);
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);
  const clusterSourceRef = useRef<React.ElementRef<typeof ShapeSource>>(null);

  // Track whether user manually toggled sections (if so, don't auto-show/hide)
  const userToggledSectionsRef = useRef(false);

  // iOS simulator tile loading retry mechanism
  const [mapKey, setMapKey] = useState(0);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  const handleMapLoadError = useCallback(() => {
    if (Platform.OS === "ios" && retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current += 1;
      console.log(
        `[RegionalMap] Load failed, retrying (${retryCountRef.current}/${MAX_RETRIES})...`,
      );
      setTimeout(() => {
        setMapKey((k) => k + 1);
      }, RETRY_DELAY_MS * retryCountRef.current);
    }
  }, []);

  // Reset retry count when style changes or map remounts
  useEffect(() => {
    retryCountRef.current = 0;
  }, [mapStyle, mapKey]);

  // Only load route signatures when the map tab is focused
  // This prevents 80+ getGpsTrack FFI calls when switching to other tabs
  const pathname = usePathname();
  const isMapFocused = pathname === "/map" || pathname.endsWith("/map");
  const routeSignatures = useRouteSignatures(isMapFocused);

  // Frequent sections from route matching (with polylines loaded)
  // useEngineSections loads full section data from Rust engine including polylines
  // This fixes iOS crash when sectionsGeoJSON creates LineString with empty coordinates
  const { sections } = useEngineSections({
    minVisits: 2,
    enabled: showSections,
  });

  // Route groups for displaying routes on the map
  const { groups: routeGroups } = useRouteGroups({ minActivities: 2 });

  // Camera, bounds, and pre-computed activity centers
  const {
    activityCenters,
    mapCenter,
    currentZoomRef,
    currentCenterRef,
    markUserInteracted,
  } = useMapCamera({ activities, routeSignatures, mapKey, cameraRef });

  // GPS trace visibility: zoom above threshold + activities visible.
  // aboveTraceZoom is state updated by handlers only on threshold crossing (avoids re-renders during pan).
  const TRACE_ZOOM_THRESHOLD = 11;
  const [aboveTraceZoom, setAboveTraceZoom] = useState(false);
  const mapRef = useRef<React.ElementRef<typeof MapView>>(null);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const bearingAnim = useRef(new Animated.Value(0)).current;

  // ===========================================
  // GESTURE TRACKING - For compass updates
  // ===========================================
  const currentZoomLevel = useRef(10); // Track current zoom for compass updates

  const isDark = isDarkStyle(mapStyle);

  // Get map style value - combined satellite style includes all regional sources
  const mapStyleValue = useMemo(() => {
    return getMapStyle(mapStyle);
  }, [mapStyle]);

  // Camera position for satellite attribution (updated by onCameraSettled callback, not on every gesture)
  const [cameraForAttribution, setCameraForAttribution] = useState<{
    center: [number, number];
    zoom: number;
  } | null>(null);

  // Initialize satellite attribution from mapCenter when activities load
  useEffect(() => {
    if (mapCenter && !cameraForAttribution) {
      setCameraForAttribution({
        center: mapCenter,
        zoom: currentZoomRef.current,
      });
    }
  }, [mapCenter, cameraForAttribution, currentZoomRef]);

  // Stable callback for camera settle notifications (uses ref to avoid dep changes)
  const mapStyleRef = useRef(mapStyle);
  mapStyleRef.current = mapStyle;
  const handleCameraSettled = useCallback(
    (center: [number, number], zoom: number) => {
      if (mapStyleRef.current === "satellite") {
        setCameraForAttribution({ center, zoom });
      }
    },
    [],
  );

  // Dynamic attribution based on visible satellite sources at current location
  const attributionText = useMemo(() => {
    if (mapStyle === "satellite" && cameraForAttribution) {
      const satAttribution = getCombinedSatelliteAttribution(
        cameraForAttribution.center[1],
        cameraForAttribution.center[0],
        cameraForAttribution.zoom,
      );
      return is3DMode
        ? `${satAttribution} | ${TERRAIN_ATTRIBUTION}`
        : satAttribution;
    }
    const baseAttribution = MAP_ATTRIBUTIONS[mapStyle];
    return is3DMode
      ? `${baseAttribution} | ${TERRAIN_ATTRIBUTION}`
      : baseAttribution;
  }, [mapStyle, cameraForAttribution, is3DMode]);

  // Notify parent when attribution changes
  useEffect(() => {
    onAttributionChange?.(attributionText);
  }, [attributionText, onAttributionChange]);

  // Filter activities to only those visible in viewport (for performance)
  // Only enable viewport culling for large activity counts to avoid marker flashing
  // With < 150 activities, showing all is fast enough and provides better UX
  const VIEWPORT_CULLING_THRESHOLD = 150;
  const visibleActivities = useMemo(() => {
    // Skip viewport culling for small activity counts - prevents marker flashing during pan
    if (activities.length < VIEWPORT_CULLING_THRESHOLD) {
      return activities;
    }
    if (!visibleActivityIds) {
      // No viewport info yet - show all activities
      return activities;
    }
    // Filter to only visible activities (only for large datasets)
    return activities.filter((a) => visibleActivityIds.has(a.id));
  }, [activities, visibleActivityIds]);

  const showTraces = aboveTraceZoom && showActivities;

  // All GeoJSON data for map layers
  const {
    markersGeoJSON,
    tracesGeoJSON,
    startPointsGeoJSON,
    sectionsGeoJSON,
    routesGeoJSON,
    routeMarkersGeoJSON,
    sectionMarkers,
    routeMarkers,
    userLocationGeoJSON,
    routeGeoJSON,
    routeHasData,
  } = useMapGeoJSON({
    allActivities: activities,
    visibleActivities,
    activityCenters,
    routeSignatures,
    sections,
    routeGroups,
    showRoutes,
    userLocation,
    selected,
    t,
  });

  // Event handlers
  const {
    handleMarkerTap,
    handleClosePopup,
    handleViewDetails,
    handleZoomToActivity,
    handleClusterOrMarkerPress,
    handleSpiderMarkerPress,
    handleMapPress,
    handleSectionPress,
    handleRegionIsChanging,
    handleRegionDidChange: baseHandleRegionDidChange,
    handleGetLocation,
    toggleActivities,
    toggleSections: baseToggleSections,
    toggleRoutes,
    resetOrientation,
    handleFitAll,
  } = useMapHandlers({
    activities,
    sections,
    selected,
    setSelected,
    setSelectedSection,
    showActivities,
    setShowActivities,
    showSections,
    setShowSections,
    showRoutes,
    setShowRoutes,
    setSelectedRoute,
    userLocation,
    setUserLocation,
    setLocationLoading,
    setVisibleActivityIds,
    currentZoomRef,
    currentCenterRef,
    setAboveTraceZoom,
    traceZoomThreshold: TRACE_ZOOM_THRESHOLD,
    onCameraSettled: handleCameraSettled,
    cameraRef,
    clusterSourceRef,
    map3DRef,
    bearingAnim,
    currentZoomLevel,
    is3DMode,
    markUserInteracted,
    setSpider,
  });

  // Auto-show sections when zoomed in to neighborhood level, auto-hide when zoomed out.
  // Manual toggles (via the control button) take precedence and disable auto-behavior.
  const SECTIONS_AUTO_SHOW_ZOOM = 13;
  const SECTIONS_AUTO_HIDE_ZOOM = 11;

  const toggleSections = useCallback(() => {
    userToggledSectionsRef.current = true;
    baseToggleSections();
  }, [baseToggleSections]);

  const handleRegionDidChange = useCallback(
    (feature: GeoJSON.Feature) => {
      baseHandleRegionDidChange(feature);

      if (userToggledSectionsRef.current) return;

      const zoomLevel = (
        feature.properties as { zoomLevel?: number } | undefined
      )?.zoomLevel;
      if (zoomLevel === undefined) return;

      if (zoomLevel >= SECTIONS_AUTO_SHOW_ZOOM && !showSections) {
        setShowSections(true);
      } else if (zoomLevel < SECTIONS_AUTO_HIDE_ZOOM && showSections) {
        setShowSections(false);
      }
    },
    [baseHandleRegionDidChange, showSections],
  );

  // Clear selections when their corresponding group visibility is turned off
  useEffect(() => {
    if (!showActivities && selected) {
      setSelected(null);
    }
  }, [showActivities, selected]);

  useEffect(() => {
    if (!showSections && selectedSection) {
      setSelectedSection(null);
    }
  }, [showSections, selectedSection]);

  useEffect(() => {
    if (!showRoutes && selectedRoute) {
      setSelectedRoute(null);
    }
  }, [showRoutes, selectedRoute]);

  // Toggle map style (cycles through light → dark → satellite)
  const toggleStyle = () => {
    setMapStyle((current) => getNextStyle(current));
  };

  // Toggle 3D mode
  const toggle3D = () => {
    setIs3DMode((current) => !current);
  };

  // Handle route press - show route popup
  const handleRoutePress = useCallback(
    (event: { features?: GeoJSON.Feature[] }) => {
      const feature = event.features?.[0];
      const routeId = feature?.properties?.id as string | undefined;
      if (routeId) {
        const route = routeGroups.find((g) => g.id === routeId);
        if (route) {
          setSelectedRoute({
            id: route.id,
            name: route.name,
            activityCount: route.activityCount,
            sportType: route.sportType,
            type: route.type,
            bestTime: route.bestTime,
          });
        }
      }
    },
    [routeGroups],
  );

  // Handle 3D section click — receives section ID string, looks up section to select
  const handle3DSectionClick = useCallback(
    (sectionId: string) => {
      const section = sections.find((s) => s.id === sectionId);
      if (section) {
        setSelectedSection(section);
      }
    },
    [sections],
  );

  // Selected activity ID for MapLibre expressions (cheap to pass, doesn't trigger GeoJSON rebuild)
  const selectedActivityId = selected?.activity.id ?? null;

  // Get 3D route coordinates from selected activity (if any)
  // Uses pre-computed routeCoords if available, falls back to mapData.latlngs
  // Filter NaN/Infinity to prevent invalid GeoJSON in Map3DWebView
  const route3DCoords = useMemo(() => {
    // Priority 1: Use pre-computed routeCoords (already in [lng, lat] format)
    if (selected?.routeCoords && selected.routeCoords.length > 0) {
      return selected.routeCoords;
    }

    // Priority 2: Fall back to mapData.latlngs
    if (!selected?.mapData?.latlngs) return [];

    return selected.mapData.latlngs
      .filter((c): c is [number, number] => c !== null)
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
      .map(([lat, lng]) => [lng, lat] as [number, number]); // Convert to [lng, lat]
  }, [selected?.routeCoords, selected?.mapData]);

  // Spider GeoJSON for cluster fan-out at max zoom
  const { spiderPointsGeoJSON, spiderLinesGeoJSON } = useMemo(() => {
    if (!spider) {
      return {
        spiderPointsGeoJSON: EMPTY_FEATURE_COLLECTION,
        spiderLinesGeoJSON: EMPTY_FEATURE_COLLECTION,
      };
    }
    const { points, lines } = buildSpiderGeoJSON(
      spider,
      currentZoomRef.current,
    );
    return { spiderPointsGeoJSON: points, spiderLinesGeoJSON: lines };
  }, [spider, currentZoomRef]);

  // 3D is available when we have any activities (terrain can be shown without a specific route)
  const can3D = activities.length > 0;
  // Show 3D view when enabled
  const show3D = is3DMode && can3D;

  // iOS tap handling (no-op on Android)
  const { onTouchStart, onTouchEnd } = useIOSTapHandler({
    mapRef,
    activities,
    sections,
    routeGroups,
    selected,
    selectedSection,
    selectedRoute,
    setSelected,
    setSelectedSection,
    setSelectedRoute,
    showActivities,
    showSections,
    showRoutes,
    show3D,
    handleMarkerTap,
    clusterSourceRef,
    cameraRef,
    currentZoomLevel,
    insetTop: insets.top,
    spider,
    setSpider,
  });

  return (
    <View
      style={styles.container}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {show3D ? (
        <ComponentErrorBoundary
          componentName="3D Map"
          showRetry={false}
          onError={() => setIs3DMode(false)}
        >
          <Map3DWebView
            ref={map3DRef}
            coordinates={route3DCoords.length > 0 ? route3DCoords : undefined}
            mapStyle={mapStyle}
            routeColor={
              selected
                ? getActivityTypeConfig(selected.activity.type).color
                : undefined
            }
            initialCenter={currentCenterRef.current ?? mapCenter ?? undefined}
            initialZoom={currentZoomRef.current}
            routesGeoJSON={
              showRoutes ? (routesGeoJSON ?? undefined) : undefined
            }
            sectionsGeoJSON={
              showSections ? (sectionsGeoJSON ?? undefined) : undefined
            }
            // In 3D mode, use showActivities directly (no zoom check - 3D doesn't track zoom)
            tracesGeoJSON={
              showActivities ? (tracesGeoJSON ?? undefined) : undefined
            }
            showHeatmap={showActivities}
            onSectionClick={handle3DSectionClick}
          />
        </ComponentErrorBoundary>
      ) : (
        <MapView
          key={`regional-map-${mapKey}`}
          ref={mapRef}
          style={styles.map}
          mapStyle={mapStyleValue}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          onPress={Platform.OS === "android" ? handleMapPress : undefined}
          onRegionIsChanging={handleRegionIsChanging}
          onRegionDidChange={handleRegionDidChange}
          onDidFailLoadingMap={handleMapLoadError}
        >
          {/* Camera with ref for programmatic control */}
          {/* No defaultSettings: Android MapLibre re-applies it on every render, causing snapback. */}
          {/* Initial positioning is done imperatively via fitBounds in useMapCamera.markUserInteracted. */}
          {/* CRITICAL: followUserLocation must be explicitly false to prevent auto-centering */}
          <Camera ref={cameraRef} followUserLocation={false} />

          {/* Activity markers — clustered ShapeSource with native MapLibre clustering */}
          {/* Replaces individual MarkerViews for better performance (GPU-rendered) */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS crash during view reconciliation */}
          <ShapeSource
            ref={clusterSourceRef}
            id="activity-clusters"
            shape={markersGeoJSON}
            cluster={true}
            clusterRadius={50}
            clusterMaxZoomLevel={17}
            onPress={
              Platform.OS === "android" && showActivities
                ? handleClusterOrMarkerPress
                : undefined
            }
            hitbox={{ width: 44, height: 44 }}
          >
            {/* Cluster circles — sized by activity count */}
            <CircleLayer
              id="cluster-circles"
              filter={["has", "point_count"]}
              style={{
                circleColor: colors.primary,
                circleRadius: [
                  "step",
                  ["get", "point_count"],
                  18, // default: 1-4 activities
                  5,
                  22, // 5-9
                  10,
                  28, // 10-24
                  25,
                  34, // 25+
                ],
                circleOpacity: showActivities ? 0.9 : 0,
                circleStrokeWidth: 2,
                circleStrokeColor: "rgba(255, 255, 255, 0.6)",
                circleStrokeOpacity: showActivities ? 1 : 0,
              }}
            />
            {/* Cluster count labels */}
            <SymbolLayer
              id="cluster-count"
              filter={["has", "point_count"]}
              style={{
                textField: ["get", "point_count_abbreviated"],
                textSize: 13,
                textColor: "#FFFFFF",
                textAllowOverlap: true,
                textIgnorePlacement: true,
                visibility: showActivities ? "visible" : "none",
              }}
            />
            {/* Individual unclustered activity points — colored by sport type */}
            <CircleLayer
              id="unclustered-point"
              filter={["!", ["has", "point_count"]]}
              style={{
                circleColor: ["get", "color"],
                circleRadius: selectedActivityId
                  ? [
                      "case",
                      ["==", ["get", "id"], selectedActivityId],
                      12, // Selected: larger
                      8,
                    ]
                  : 8,
                circleOpacity: showActivities ? 1 : 0,
                circleStrokeWidth: selectedActivityId
                  ? [
                      "case",
                      ["==", ["get", "id"], selectedActivityId],
                      2.5,
                      1.5,
                    ]
                  : 1.5,
                circleStrokeColor: selectedActivityId
                  ? [
                      "case",
                      ["==", ["get", "id"], selectedActivityId],
                      colors.primary,
                      "rgba(255, 255, 255, 0.8)",
                    ]
                  : "rgba(255, 255, 255, 0.8)",
                circleStrokeOpacity: showActivities ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* Routes layer - solid wider polylines for route groups (purple family) */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash during reconciliation */}
          <ShapeSource
            id="routes"
            shape={routesGeoJSON}
            onPress={handleRoutePress}
            hitbox={{ width: 44, height: 44 }}
          >
            {/* Route outline — dark border for depth and readability */}
            <LineLayer
              id="routesOutline"
              style={{
                visibility: showRoutes ? "visible" : "none",
                lineColor: "rgba(0, 0, 0, 0.3)",
                lineWidth: [
                  "case",
                  ["==", ["get", "id"], selectedRoute?.id ?? ""],
                  12, // Wide glow when selected
                  8,
                ],
                lineOpacity: [
                  "case",
                  ["==", ["get", "id"], selectedRoute?.id ?? ""],
                  0.7,
                  0.4,
                ],
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <LineLayer
              id="routesLine"
              style={{
                visibility: showRoutes ? "visible" : "none",
                lineColor: ["get", "color"],
                lineWidth: [
                  "case",
                  ["==", ["get", "id"], selectedRoute?.id ?? ""],
                  8, // Bold when selected
                  5,
                ],
                lineOpacity: [
                  "case",
                  ["==", ["get", "id"], selectedRoute?.id ?? ""],
                  1,
                  0.85,
                ],
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </ShapeSource>

          {/* Route markers - start points for routes */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash */}
          <ShapeSource id="route-markers" shape={routeMarkersGeoJSON}>
            <CircleLayer
              id="routeMarkerCircle"
              style={{
                circleRadius: 0, // Hidden - using MarkerViews instead
                circleOpacity: 0,
              }}
            />
          </ShapeSource>

          {/* Sections layer - frequent road/trail sections */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash */}
          <ShapeSource
            id="sections"
            shape={sectionsGeoJSON}
            onPress={handleSectionPress}
            hitbox={{ width: 44, height: 44 }}
          >
            <LineLayer
              id="sectionsLine"
              style={{
                lineColor: ["get", "color"],
                lineWidth: selectedSection
                  ? [
                      "case",
                      ["==", ["get", "id"], selectedSection.id],
                      9, // Bold + prominent when selected
                      4,
                    ]
                  : ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 5, 18, 7],
                lineOpacity: showSections
                  ? selectedSection
                    ? [
                        "case",
                        ["==", ["get", "id"], selectedSection.id],
                        1,
                        0.55, // Dim unselected to make selected pop
                      ]
                    : 0.92
                  : 0,
                lineDasharray: [4, 2],
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            {/* Section outline — white border for contrast on any map style */}
            <LineLayer
              id="sectionsOutline"
              style={{
                lineColor: selectedSection
                  ? [
                      "case",
                      ["==", ["get", "id"], selectedSection.id],
                      "#FFFFFF",
                      "rgba(255,255,255,0.4)",
                    ]
                  : "#FFFFFF",
                lineWidth: selectedSection
                  ? [
                      "case",
                      ["==", ["get", "id"], selectedSection.id],
                      14, // Wide glow behind selected section
                      7,
                    ]
                  : ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 8, 18, 10],
                lineOpacity: showSections
                  ? selectedSection
                    ? [
                        "case",
                        ["==", ["get", "id"], selectedSection.id],
                        0.8, // Bright glow when selected
                        0.35,
                      ]
                    : 0.55
                  : 0,
                lineCap: "round",
                lineJoin: "round",
              }}
              belowLayerID="sectionsLine"
            />
          </ShapeSource>

          {/* Raster heatmap tiles — replaces vector traces for performance */}
          <RasterSource
            id="heatmap-tiles"
            tileUrlTemplates={[HEATMAP_TILE_URL_TEMPLATE]}
            minZoomLevel={5}
            maxZoomLevel={17}
            tileSize={256}
          >
            <RasterLayer
              id="heatmap-layer"
              style={{
                rasterOpacity: showActivities
                  ? mapStyle === "light"
                    ? 0.82
                    : 0.72
                  : 0,
                rasterContrast: mapStyle === "light" ? 0.25 : 0,
                rasterBrightnessMax: mapStyle === "light" ? 0.7 : 1,
                rasterSaturation: mapStyle === "light" ? 0.4 : 0,
                rasterResampling: "linear",
                rasterFadeDuration: 0,
              }}
              belowLayerID="cluster-circles"
            />
          </RasterSource>

          {/* CRITICAL: Always render ShapeSource to avoid iOS MapLibre crash */}
          {/* Vector traces fully replaced by raster heatmap — no LineLayer needed */}
          {/* ShapeSource kept mounted (empty) to prevent Fabric view reconciliation crash */}
          <ShapeSource id="activity-traces" shape={tracesGeoJSON} />

          {/* Activity start-point markers — small dots at the first GPS coordinate */}
          {/* Visible when zoomed in past trace threshold and activities are shown */}
          <ShapeSource id="activity-start-points" shape={startPointsGeoJSON}>
            <CircleLayer
              id="start-point-outer"
              style={{
                circleRadius: 5,
                circleColor: ["get", "color"],
                circleOpacity: showTraces ? 0.9 : 0,
                circleStrokeWidth: 1.5,
                circleStrokeColor: "#FFFFFF",
                circleStrokeOpacity: showTraces ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* Selected activity route */}
          {/* CRITICAL: Always render with fixed ID to avoid iOS MapLibre crash */}
          <ShapeSource id="selected-route" shape={routeGeoJSON}>
            {/* Outline layer for better visibility */}
            <LineLayer
              id="selected-routeOutline"
              style={{
                lineColor: colors.textOnDark,
                lineWidth: 8,
                lineCap: "round",
                lineJoin: "round",
                lineOpacity: routeHasData ? 0.5 : 0,
              }}
            />
            <LineLayer
              id="selected-routeLine"
              style={{
                lineColor: selected
                  ? getActivityTypeConfig(selected.activity.type).color
                  : "#000",
                lineWidth: 5,
                lineCap: "round",
                lineJoin: "round",
                lineOpacity: routeHasData ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* Section markers - start points with road icon */}
          {/* CRITICAL: Always render to avoid iOS crash - use opacity to hide */}
          {sectionMarkers.map((marker) => {
            const isVisible = showSections;
            const isSelected = selectedSection?.id === marker.id;

            return (
              <MarkerView
                key={`section-marker-${marker.id}`}
                coordinate={marker.coordinate}
                anchor={{ x: 0.5, y: 0.5 }}
                allowOverlap={true}
              >
                <View
                  testID={`map-section-marker-${marker.id}`}
                  pointerEvents="none"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: isSelected ? colors.primary : "#4CAF50",
                    borderWidth: 2,
                    borderColor: colors.textOnDark,
                    justifyContent: "center",
                    alignItems: "center",
                    opacity: isVisible ? 1 : 0,
                    ...shadows.elevated,
                  }}
                >
                  <MaterialCommunityIcons
                    name="road-variant"
                    size={18}
                    color={colors.textOnDark}
                  />
                </View>
              </MarkerView>
            );
          })}

          {/* Route markers - start points with path icon */}
          {/* CRITICAL: Always render to avoid iOS crash - use opacity to hide */}
          {routeMarkers.map((marker) => {
            const isVisible = showRoutes;
            const isSelected = selectedRoute?.id === marker.id;

            return (
              <MarkerView
                key={`route-marker-${marker.id}`}
                coordinate={marker.coordinate}
                anchor={{ x: 0.5, y: 0.5 }}
                allowOverlap={true}
              >
                <View
                  testID={`map-route-marker-${marker.id}`}
                  pointerEvents="none"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: isSelected
                      ? colors.primary
                      : ROUTE_COLORS[0],
                    borderWidth: 2,
                    borderColor: colors.textOnDark,
                    justifyContent: "center",
                    alignItems: "center",
                    opacity: isVisible ? 1 : 0,
                    ...shadows.elevated,
                  }}
                >
                  <MaterialCommunityIcons
                    name="map-marker-path"
                    size={18}
                    color={colors.textOnDark}
                  />
                </View>
              </MarkerView>
            );
          })}

          {/* Spider fan-out layers — show when a cluster can't expand further at max zoom */}
          {/* CRITICAL: Always render ShapeSource to avoid iOS crash during reconciliation */}
          <ShapeSource id="spider-legs" shape={spiderLinesGeoJSON}>
            <LineLayer
              id="spider-lines"
              style={{
                lineColor: isDark
                  ? "rgba(255, 255, 255, 0.5)"
                  : "rgba(0, 0, 0, 0.3)",
                lineWidth: 1.5,
                lineOpacity: spider ? 1 : 0,
              }}
            />
          </ShapeSource>
          <ShapeSource
            id="spider-markers"
            shape={spiderPointsGeoJSON}
            onPress={
              Platform.OS === "android" && spider
                ? handleSpiderMarkerPress
                : undefined
            }
            hitbox={{ width: 44, height: 44 }}
          >
            <CircleLayer
              id="spider-points"
              style={{
                circleColor: ["get", "color"],
                circleRadius: 10,
                circleOpacity: spider ? 1 : 0,
                circleStrokeWidth: 2,
                circleStrokeColor: "#FFFFFF",
                circleStrokeOpacity: spider ? 1 : 0,
              }}
            />
          </ShapeSource>

          {/* User location marker - using ShapeSource + CircleLayer to avoid Fabric crash */}
          {/* CRITICAL: Always render to prevent add/remove cycles that crash iOS */}
          <ShapeSource id="user-location" shape={userLocationGeoJSON}>
            <CircleLayer
              id="user-location-outer"
              style={{
                circleRadius: 12,
                circleColor: colors.primary,
                circleOpacity: userLocation ? 0.3 : 0,
                circleStrokeWidth: 0,
              }}
            />
            <CircleLayer
              id="user-location-inner"
              style={{
                circleRadius: 6,
                circleColor: colors.primary,
                circleOpacity: userLocation ? 1 : 0,
                circleStrokeWidth: 2,
                circleStrokeColor: colors.textOnDark,
              }}
            />
          </ShapeSource>
        </MapView>
      )}

      {/* Style toggle */}
      <TouchableOpacity
        style={[
          styles.button,
          styles.styleButton,
          { top: insets.top + 12 },
          isDark && styles.buttonDark,
        ]}
        onPress={toggleStyle}
        activeOpacity={0.8}
        accessibilityLabel={t("maps.toggleStyle")}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons
          name={getStyleIcon(mapStyle)}
          size={24}
          color={isDark ? colors.textOnDark : colors.textSecondary}
        />
      </TouchableOpacity>
      {/* Control button stack - positioned in middle of right side */}
      <MapControlStack
        top={insets.top + 64}
        isDark={isDark}
        is3DMode={is3DMode}
        can3D={can3D}
        showActivities={showActivities}
        showSections={showSections}
        showRoutes={showRoutes}
        userLocationActive={!!userLocation}
        locationLoading={locationLoading}
        sections={sections}
        routeCount={routeGroups.length}
        activityCount={activities.length}
        bearingAnim={bearingAnim}
        onToggle3D={toggle3D}
        onResetOrientation={resetOrientation}
        onGetLocation={handleGetLocation}
        onToggleActivities={toggleActivities}
        onToggleSections={toggleSections}
        onToggleRoutes={toggleRoutes}
        onFitAll={handleFitAll}
      />
      {/* Attribution */}
      {showAttribution && (
        <View
          style={[
            styles.attribution,
            { bottom: insets.bottom + attributionBottomOffset },
          ]}
        >
          <Text style={styles.attributionText}>{attributionText}</Text>
        </View>
      )}
      {/* Selected activity popup - positioned above the timeline slider */}
      {selected && (
        <ActivityPopup
          selected={selected}
          bottom={insets.bottom + 200}
          onZoom={handleZoomToActivity}
          onClose={handleClosePopup}
          onViewDetails={handleViewDetails}
        />
      )}
      {/* Section popup - shows when a section is tapped */}
      {selectedSection && (
        <SectionPopup
          section={selectedSection}
          bottom={insets.bottom + 200}
          onClose={() => setSelectedSection(null)}
          onViewDetails={() => {
            setSelectedSection(null);
            router.push(`/section/${selectedSection.id}`);
          }}
        />
      )}
      {/* Route popup - shows when a route is tapped */}
      {selectedRoute && (
        <RoutePopup
          route={selectedRoute}
          bottom={insets.bottom + 200}
          onClose={() => setSelectedRoute(null)}
          onViewDetails={() => {
            setSelectedRoute(null);
            router.push(`/route/${selectedRoute.id}`);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.background,
  },
  map: {
    flex: 1,
  },
  button: {
    position: "absolute",
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    justifyContent: "center",
    alignItems: "center",
    ...shadows.mapOverlay,
  },
  buttonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  styleButton: {
    right: spacing.md,
  },
  attribution: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderTopLeftRadius: spacing.sm,
    zIndex: 5,
  },
  attributionText: {
    fontSize: 9,
    color: colors.textSecondary,
  },
});
