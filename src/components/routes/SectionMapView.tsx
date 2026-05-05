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
  StyleSheet,
  TouchableOpacity,
  Modal,
  StatusBar,
  Animated,
  ActivityIndicator,
} from 'react-native';
import {
  Map as MLMap,
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
  type CameraRef,
  type ViewStateChangeEvent,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';
import type { NativeSyntheticEvent } from 'react-native';
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import { toLngLatBounds, toViewPadding } from '@/lib/maps/bounds';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { getActivityColor, getBoundsFromPoints } from '@/lib';
import { colors, darkColors, spacing, layout, shadows } from '@/theme';
import { useMapPreferences } from '@/providers';
import {
  getMapStyle,
  BaseMapView,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
} from '@/components/maps';
import { Map3DWebView, type Map3DWebViewRef } from '@/components/maps/Map3DWebView';
import { CompassArrow, ComponentErrorBoundary } from '@/components/ui';
import { useMapFullscreen } from '@/hooks/maps/useMapFullscreen';
import { decodeCoords } from 'veloqrs';
import type { FrequentSection, RoutePoint, ActivityType } from '@/types';

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
  nearbyPolylines?: Array<{
    id: string;
    name?: string;
    sportType: string;
    distanceMeters: number;
    visitCount: number;
    encodedPolyline: ArrayBuffer;
  }>;
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
  const cameraRef = useRef<CameraRef>(null);

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
      void cameraRef.current.setStop({
        bounds: toLngLatBounds(newBounds),
        padding: toViewPadding({
          paddingTop: 80,
          paddingRight: 80,
          paddingBottom: 80,
          paddingLeft: 80,
        }),
        duration: 500,
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
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      bearingAnim.setValue(-event.nativeEvent.bearing);
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
      void cameraRef.current?.setStop({
        bearing: 0,
        duration: 300,
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
      void cameraRef.current?.setStop({
        center: coords,
        zoom: 14,
        duration: 500,
      });
    } catch {
      setLocationLoading(false);
    }
  }, []);

  // Create GeoJSON for the section polyline
  // CRITICAL: Always return valid GeoJSON to avoid iOS MapLibre crash during view reconciliation
  // Empty FeatureCollection is safe - LineLayer just doesn't render anything
  const emptyCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  // GeoJSON LineString requires minimum 2 coordinates
  const sectionGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    // Filter out NaN/Infinity coordinates
    const validPoints = displayPoints.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    // LineString requires at least 2 valid coordinates
    if (validPoints.length < 2) return emptyCollection;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validPoints.map((p) => [p.lng, p.lat]),
      },
    };
  }, [displayPoints]);

  // GeoJSON for the trimmed portion (when trim range is active)
  // In expand mode, trim indices are relative to extensionTrack (window points), not section polyline
  const trimmedGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    if (!trimRange) return emptyCollection;
    const sourcePoints =
      extensionTrack && extensionTrack.length > 0 ? extensionTrack : displayPoints;
    if (sourcePoints.length < 2) return emptyCollection;
    const sliced = sourcePoints.slice(trimRange.start, trimRange.end + 1);
    const validPoints = sliced.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validPoints.length < 2) return emptyCollection;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validPoints.map((p) => [p.lng, p.lat]),
      },
    };
  }, [displayPoints, extensionTrack, trimRange]);

  // Create GeoJSON for the shadow track (full activity route)
  const shadowGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    if (!shadowTrack || shadowTrack.length < 2) return emptyCollection;
    // Filter out NaN/Infinity coordinates
    const validCoords = shadowTrack.filter(
      ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)
    );
    if (validCoords.length < 2) return emptyCollection;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [shadowTrack]);

  // Create GeoJSON for the extension track (representative activity's full track)
  const extensionGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    if (!extensionTrack || extensionTrack.length < 2) return emptyCollection;
    const validCoords = extensionTrack.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    if (validCoords.length < 2) return emptyCollection;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords.map((p) => [p.lng, p.lat]),
      },
    };
  }, [extensionTrack]);

  // Create FeatureCollection for nearby section polylines (muted gray overlays)
  const nearbyGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!nearbyPolylines || nearbyPolylines.length === 0) return emptyCollection;
    const features = nearbyPolylines
      .map((entry) => {
        if (!entry.encodedPolyline) return null;
        const decoded = decodeCoords(entry.encodedPolyline);
        if (decoded.length < 2) return null;
        const coordinates: [number, number][] = decoded
          .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
          .map((p) => [p.longitude, p.latitude]);
        if (coordinates.length < 2) return null;
        return {
          type: 'Feature' as const,
          properties: { sectionId: entry.id },
          geometry: {
            type: 'LineString' as const,
            coordinates,
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    return { type: 'FeatureCollection', features };
  }, [nearbyPolylines]);

  // Create FeatureCollection with ALL activity traces for fast scrubbing
  const allTracesFeatureCollection = useMemo((): GeoJSON.FeatureCollection => {
    if (!allActivityTraces || Object.keys(allActivityTraces).length === 0) return emptyCollection;

    const features = Object.entries(allActivityTraces)
      .map(([activityId, points]) => {
        if (!points) return null;
        // Filter out NaN/Infinity coordinates
        const validPoints = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        // LineString requires at least 2 valid coordinates
        if (validPoints.length < 2) return null;
        return {
          type: 'Feature' as const,
          properties: { activityId },
          geometry: {
            type: 'LineString' as const,
            coordinates: validPoints.map((p) => [p.lng, p.lat]),
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    return { type: 'FeatureCollection', features };
  }, [allActivityTraces]);

  // Helper to check if allTracesFeatureCollection has data
  const hasAllTraces = allTracesFeatureCollection.features.length > 0;

  // Filter expression to show only the highlighted activity trace
  const highlightedTraceFilter = useMemo((): FilterSpecification | undefined => {
    if (!highlightedActivityId || !hasAllTraces) return undefined;
    // MapLibre expression: ["==", ["get", "activityId"], "some-id"]
    return ['==', ['get', 'activityId'], highlightedActivityId];
  }, [highlightedActivityId, hasAllTraces]);

  // Create GeoJSON for highlighted trace (activity being scrubbed)
  // This is the fallback when allActivityTraces is not provided
  const highlightedTraceGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    // If we have pre-loaded traces, use the filter approach instead
    if (hasAllTraces) return emptyCollection;

    // Lap points take precedence
    if (highlightedLapPoints && highlightedLapPoints.length > 1) {
      // Filter out NaN/Infinity coordinates
      const validPoints = highlightedLapPoints.filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      );
      if (validPoints.length < 2) return emptyCollection;
      return {
        type: 'Feature' as const,
        properties: { id: 'highlighted-lap' },
        geometry: {
          type: 'LineString' as const,
          coordinates: validPoints.map((p) => [p.lng, p.lat]),
        },
      };
    }

    // If we have a highlighted activity ID and activity traces, use that
    if (highlightedActivityId && section.activityTraces) {
      const activityTrace = section.activityTraces[highlightedActivityId];
      if (activityTrace && activityTrace.length > 1) {
        // Filter out NaN/Infinity coordinates
        const validPoints = activityTrace.filter(
          (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
        );
        if (validPoints.length < 2) return emptyCollection;
        return {
          type: 'Feature' as const,
          properties: { id: highlightedActivityId },
          geometry: {
            type: 'LineString' as const,
            coordinates: validPoints.map((p) => [p.lng, p.lat]),
          },
        };
      }
    }

    return emptyCollection;
  }, [highlightedActivityId, highlightedLapPoints, section.activityTraces, hasAllTraces]);

  // GeoJSON for highlighted lap points (when scrubbing shows specific lap portion)
  const highlightedLapGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    if (!highlightedLapPoints || highlightedLapPoints.length < 2) return emptyCollection;
    // Filter out NaN/Infinity coordinates
    const validPoints = highlightedLapPoints.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    if (validPoints.length < 2) return emptyCollection;
    return {
      type: 'Feature' as const,
      properties: { id: 'highlighted-lap' },
      geometry: {
        type: 'LineString' as const,
        coordinates: validPoints.map((p) => [p.lng, p.lat]),
      },
    };
  }, [highlightedLapPoints]);

  // Adjust opacity when something is highlighted or trimming
  const sectionOpacity = highlightedActivityId || highlightedLapPoints || trimRange ? 0.4 : 1;

  const styleUrl = getMapStyle(currentMapStyle);

  // Use trimmed positions for markers when trimming
  const startPoint = trimRange ? displayPoints[trimRange.start] : displayPoints[0];
  const endPoint = trimRange
    ? displayPoints[trimRange.end]
    : displayPoints[displayPoints.length - 1];

  if (!bounds || displayPoints.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  const mapContent = (
    <MLMap
      ref={mapRef}
      style={styles.map}
      mapStyle={styleUrl}
      logo={false}
      attribution={false}
      compass={false}
      dragPan={interactive}
      touchZoom={interactive}
      touchRotate={interactive}
      touchPitch={false}
      onRegionIsChanging={interactive ? handleRegionIsChanging : undefined}
    >
      <Camera
        maxZoom={16}
        ref={interactive ? cameraRef : undefined}
        initialViewState={{
          bounds: toLngLatBounds(bounds),
          padding: toViewPadding({
            paddingTop: 80,
            paddingRight: 80,
            paddingBottom: 80,
            paddingLeft: 80,
          }),
        }}
      />

      {/* Nearby section polylines (muted gray, tappable for preview) */}
      <GeoJSONSource
        id="nearbySource"
        data={nearbyGeoJSON}
        onPress={(e: NativeSyntheticEvent<PressEventWithFeatures>) => {
          const feature = e.nativeEvent.features?.[0];
          const sectionId = feature?.properties?.sectionId;
          if (sectionId) {
            setSelectedNearby(selectedNearby === sectionId ? null : sectionId);
          }
        }}
        hitbox={{ top: 10, right: 10, bottom: 10, left: 10 }}
      >
        <Layer
          type="line"
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
      </GeoJSONSource>

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
            <Marker id={`nearby-start-${entry.id}`} lngLat={startCoord}>
              <View style={styles.markerContainer}>
                <View style={[styles.nearbyMarker, styles.nearbyStartMarker]} />
              </View>
            </Marker>
            <Marker id={`nearby-end-${entry.id}`} lngLat={endCoord}>
              <View style={styles.markerContainer}>
                <View style={[styles.nearbyMarker, styles.nearbyEndMarker]} />
              </View>
            </Marker>
          </React.Fragment>
        );
      })}

      {/* Shadow track (full activity route) */}
      {/* CRITICAL: Always render all ShapeSources to avoid iOS crash during view reconciliation */}
      {/* Shadow track (full activity route) */}
      <GeoJSONSource id="shadowSource" data={shadowGeoJSON}>
        <Layer
          type="line"
          id="shadowLine"
          style={{
            lineColor: colors.gray500,
            lineOpacity: 0.5,
            lineWidth: 3,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </GeoJSONSource>

      {/* Extension track (representative activity's full route, shown during bounds editing) */}
      <GeoJSONSource id="extensionSource" data={extensionGeoJSON}>
        <Layer
          type="line"
          id="extensionLineCasing"
          style={{
            lineColor: '#000000',
            lineOpacity: extensionTrack ? 0.5 : 0,
            lineWidth: 6,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <Layer
          type="line"
          id="extensionLine"
          style={{
            lineColor: '#FF6B00',
            lineOpacity: extensionTrack ? 1 : 0,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </GeoJSONSource>

      {/* Section polyline */}
      <GeoJSONSource id="sectionSource" data={sectionGeoJSON}>
        <Layer
          type="line"
          id="sectionLineCasing"
          style={{
            lineColor: '#FFFFFF',
            lineOpacity: sectionOpacity,
            lineWidth: 5,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <Layer
          type="line"
          id="sectionLine"
          style={{
            lineColor: activityColor,
            lineOpacity: sectionOpacity,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </GeoJSONSource>

      {/* Trimmed section portion (highlighted during bounds editing) */}
      <GeoJSONSource id="trimmedSource" data={trimmedGeoJSON}>
        <Layer
          type="line"
          id="trimmedLineCasing"
          style={{
            lineColor: '#FFFFFF',
            lineOpacity: trimRange ? 1 : 0,
            lineWidth: 5,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <Layer
          type="line"
          id="trimmedLine"
          style={{
            lineColor: activityColor,
            lineOpacity: trimRange ? 1 : 0,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </GeoJSONSource>

      {/* Pre-loaded activity traces with filter */}
      <GeoJSONSource id="allTracesSource" data={allTracesFeatureCollection}>
        <Layer
          type="line"
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
        <Layer
          type="line"
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
      </GeoJSONSource>

      {/* Highlighted lap points overlay */}
      <GeoJSONSource id="highlightedLapSource" data={highlightedLapGeoJSON}>
        <Layer
          type="line"
          id="highlightedLapLineCasing"
          style={{
            lineColor: '#FFFFFF',
            lineOpacity: 1,
            lineWidth: 6,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <Layer
          type="line"
          id="highlightedLapLine"
          style={{
            lineColor: colors.chartCyan,
            lineWidth: 5,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </GeoJSONSource>

      {/* Fallback: Highlighted activity trace */}
      <GeoJSONSource id="highlightedSource" data={highlightedTraceGeoJSON}>
        <Layer
          type="line"
          id="highlightedLineCasing"
          style={{
            lineColor: '#FFFFFF',
            lineOpacity: 1,
            lineWidth: 5,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <Layer
          type="line"
          id="highlightedLine"
          style={{
            lineColor: colors.chartCyan,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </GeoJSONSource>

      {/* Start marker */}
      {/* iOS CRASH FIX: Always render Marker to maintain stable child count */}
      {/* Use opacity to hide when point is undefined */}
      <Marker id="section-start" lngLat={startPoint ? [startPoint.lng, startPoint.lat] : [0, 0]}>
        <View style={[styles.markerContainer, { opacity: startPoint ? 1 : 0 }]}>
          <View style={[styles.marker, styles.startMarker]} />
        </View>
      </Marker>

      {/* End marker */}
      {/* iOS CRASH FIX: Always render Marker to maintain stable child count */}
      <Marker id="section-end" lngLat={endPoint ? [endPoint.lng, endPoint.lat] : [0, 0]}>
        <View style={[styles.markerContainer, { opacity: endPoint ? 1 : 0 }]}>
          <View style={[styles.marker, styles.endMarker]} />
        </View>
      </Marker>
    </MLMap>
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
          {/* CRITICAL: Always render all GeoJSONSources to avoid iOS crash */}
          {/* Shadow track (full activity route) */}
          <GeoJSONSource id="fullscreenShadowSource" data={shadowGeoJSON}>
            <Layer
              type="line"
              id="fullscreenShadowLine"
              style={{
                lineColor: colors.gray500,
                lineOpacity: 0.5,
                lineWidth: 3,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </GeoJSONSource>

          {/* Trimmed section portion (for bounds editing) */}
          <GeoJSONSource id="fullscreenTrimmedSource" data={trimmedGeoJSON}>
            <Layer
              type="line"
              id="fullscreenTrimmedLineCasing"
              style={{
                lineColor: '#FFFFFF',
                lineOpacity: trimRange ? 1 : 0,
                lineWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <Layer
              type="line"
              id="fullscreenTrimmedLine"
              style={{
                lineColor: activityColor,
                lineOpacity: trimRange ? 1 : 0,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </GeoJSONSource>

          {/* Pre-loaded activity traces with filter */}
          <GeoJSONSource id="fullscreenAllTracesSource" data={allTracesFeatureCollection}>
            <Layer
              type="line"
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
            <Layer
              type="line"
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
          </GeoJSONSource>

          {/* Highlighted lap points overlay */}
          <GeoJSONSource id="fullscreenHighlightedLapSource" data={highlightedLapGeoJSON}>
            <Layer
              type="line"
              id="fullscreenHighlightedLapLineCasing"
              style={{
                lineColor: '#FFFFFF',
                lineOpacity: 1,
                lineWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <Layer
              type="line"
              id="fullscreenHighlightedLapLine"
              style={{
                lineColor: colors.chartCyan,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </GeoJSONSource>

          {/* Fallback: Highlighted activity trace */}
          <GeoJSONSource id="fullscreenHighlightedSource" data={highlightedTraceGeoJSON}>
            <Layer
              type="line"
              id="fullscreenHighlightedLineCasing"
              style={{
                lineColor: '#FFFFFF',
                lineOpacity: 1,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <Layer
              type="line"
              id="fullscreenHighlightedLine"
              style={{
                lineColor: colors.chartCyan,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </GeoJSONSource>

          {/* Start marker */}
          {startPoint && (
            <Marker id="fs-section-start" lngLat={[startPoint.lng, startPoint.lat]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.startMarker]} />
              </View>
            </Marker>
          )}

          {/* End marker */}
          {endPoint && (
            <Marker id="fs-section-end" lngLat={[endPoint.lng, endPoint.lat]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.endMarker]} />
              </View>
            </Marker>
          )}
        </BaseMapView>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    position: 'relative',
  },
  container: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: layout.borderRadius,
  },
  mapLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  map3DLayer: {
    zIndex: 1,
  },
  hiddenLayer: {
    opacity: 0,
    pointerEvents: 'none',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: layout.borderRadius,
  },
  map: {
    flex: 1,
  },
  placeholder: {
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
  nearbyMarker: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.textOnDark,
    opacity: 0.5,
  },
  nearbyStartMarker: {
    backgroundColor: 'rgba(34,197,94,0.6)',
  },
  nearbyEndMarker: {
    backgroundColor: 'rgba(239,68,68,0.6)',
  },
  nearbyPopup: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: spacing.sm,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadows.card,
  },
  nearbyPopupDark: {
    backgroundColor: darkColors.surface,
  },
  nearbyPopupContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nearbyPopupInfo: {
    flex: 1,
  },
  nearbyPopupName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  nearbyPopupMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  nearbyPopupViewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  nearbyPopupViewText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  nearbyPopupClose: {
    padding: spacing.xs,
  },
  expandOverlay: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 6,
    padding: spacing.xs,
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
