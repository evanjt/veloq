/**
 * Hero map view for section detail page.
 * Displays the section polyline (medoid trace) prominently.
 *
 * Performance optimization: Pre-loads all activity traces as a FeatureCollection
 * and uses filter expressions to show/hide them. This avoids expensive shape
 * geometry updates when the user scrubs through different activities.
 *
 * Wrapped in React.memo to prevent re-renders during scrubbing when props are stable.
 */

import React, { useMemo, useRef, useState, useCallback, memo } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, StatusBar } from 'react-native';
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  MarkerView,
} from '@maplibre/maplibre-react-native';
import type { Expression } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor, getBoundsFromPoints } from '@/lib';
import { colors, spacing, layout } from '@/theme';
import { useMapPreferences } from '@/providers';
import { getMapStyle, BaseMapView, isDarkStyle } from '@/components/maps';
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
}: SectionMapViewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { getStyleForActivity } = useMapPreferences();

  // Validate sport type from Rust engine, fallback to 'Ride' if invalid
  // This prevents crashes when native module returns unexpected sport types
  const validSportType: ActivityType = isValidActivityType(section.sportType)
    ? section.sportType
    : 'Ride'; // Safe fallback

  const mapStyle = getStyleForActivity(validSportType);
  const activityColor = getActivityColor(validSportType);
  const mapRef = useRef(null);

  const displayPoints = section.polyline || [];

  // Calculate bounds from the section polyline (15% padding)
  const bounds = useMemo(() => getBoundsFromPoints(displayPoints, 0.15), [displayPoints]);

  // Create GeoJSON for the section polyline
  // GeoJSON LineString requires minimum 2 coordinates - invalid data causes iOS crash:
  // -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207)
  const sectionGeoJSON = useMemo(() => {
    // Filter out NaN/Infinity coordinates
    const validPoints = displayPoints.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    // LineString requires at least 2 valid coordinates
    if (validPoints.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validPoints.map((p) => [p.lng, p.lat]),
      },
    };
  }, [displayPoints]);

  // Create GeoJSON for the shadow track (full activity route)
  // Filter NaN/Infinity to prevent iOS MapLibre crash
  const shadowGeoJSON = useMemo(() => {
    if (!shadowTrack || shadowTrack.length < 2) return null;
    // Filter out NaN/Infinity coordinates
    const validCoords = shadowTrack.filter(
      ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)
    );
    if (validCoords.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [shadowTrack]);

  // Create FeatureCollection with ALL activity traces for fast scrubbing
  // This is computed once when allActivityTraces changes, not on each highlight change
  // Filter NaN/Infinity coordinates to prevent iOS MapLibre crash
  const allTracesFeatureCollection = useMemo(() => {
    if (!allActivityTraces || Object.keys(allActivityTraces).length === 0) return null;

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

    if (features.length === 0) return null;

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [allActivityTraces]);

  // Filter expression to show only the highlighted activity trace
  // This is a lightweight update - MapLibre only changes visibility, no geometry re-processing
  const highlightedTraceFilter = useMemo((): Expression | undefined => {
    if (!highlightedActivityId || !allTracesFeatureCollection) return undefined;
    // MapLibre expression: ["==", ["get", "activityId"], "some-id"]
    return ['==', ['get', 'activityId'], highlightedActivityId];
  }, [highlightedActivityId, allTracesFeatureCollection]);

  // Create GeoJSON for highlighted trace (activity being scrubbed)
  // This is the fallback when allActivityTraces is not provided
  // Filter NaN/Infinity coordinates to prevent iOS MapLibre crash
  const highlightedTraceGeoJSON = useMemo(() => {
    // If we have pre-loaded traces, use the filter approach instead
    if (allTracesFeatureCollection) return null;

    // Lap points take precedence
    if (highlightedLapPoints && highlightedLapPoints.length > 1) {
      // Filter out NaN/Infinity coordinates
      const validPoints = highlightedLapPoints.filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      );
      if (validPoints.length < 2) return null;
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
        if (validPoints.length < 2) return null;
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

    return null;
  }, [
    highlightedActivityId,
    highlightedLapPoints,
    section.activityTraces,
    allTracesFeatureCollection,
  ]);

  // GeoJSON for highlighted lap points (when scrubbing shows specific lap portion)
  // Filter NaN/Infinity coordinates to prevent iOS MapLibre crash
  const highlightedLapGeoJSON = useMemo(() => {
    if (!highlightedLapPoints || highlightedLapPoints.length < 2) return null;
    // Filter out NaN/Infinity coordinates
    const validPoints = highlightedLapPoints.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    if (validPoints.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: { id: 'highlighted-lap' },
      geometry: {
        type: 'LineString' as const,
        coordinates: validPoints.map((p) => [p.lng, p.lat]),
      },
    };
  }, [highlightedLapPoints]);

  // Adjust opacity when something is highlighted
  const sectionOpacity = highlightedActivityId || highlightedLapPoints ? 0.4 : 1;

  const styleUrl = getMapStyle(mapStyle);

  const startPoint = displayPoints[0];
  const endPoint = displayPoints[displayPoints.length - 1];

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
      compassEnabled={interactive}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={false}
    >
      <Camera
        bounds={bounds}
        padding={{
          paddingTop: 40,
          paddingRight: 40,
          paddingBottom: 40,
          paddingLeft: 40,
        }}
        animationDuration={0}
      />

      {/* Shadow track (full activity route) */}
      {shadowGeoJSON && (
        <ShapeSource id="shadowSource" shape={shadowGeoJSON}>
          <LineLayer
            id="shadowLine"
            style={{
              lineColor: colors.gray500, // Neutral gray - distinct from section color
              lineOpacity: 0.5,
              lineWidth: 3,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}

      {/* Section polyline */}
      {sectionGeoJSON && (
        <ShapeSource id="sectionSource" shape={sectionGeoJSON}>
          <LineLayer
            id="sectionLine"
            style={{
              lineColor: activityColor,
              lineOpacity: sectionOpacity,
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}

      {/* Pre-loaded activity traces with filter - SKIP during scrubbing to avoid lag */}
      {!isScrubbing && allTracesFeatureCollection && highlightedTraceFilter && (
        <ShapeSource id="allTracesSource" shape={allTracesFeatureCollection}>
          <LineLayer
            id="allTracesLine"
            filter={highlightedTraceFilter}
            style={{
              lineColor: colors.chartCyan,
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}

      {/* Highlighted lap points overlay - SHOW during scrubbing (small, fast to render) */}
      {highlightedLapGeoJSON && (
        <ShapeSource id="highlightedLapSource" shape={highlightedLapGeoJSON}>
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
      )}

      {/* Fallback: Highlighted activity trace - SKIP during scrubbing */}
      {!isScrubbing && highlightedTraceGeoJSON && (
        <ShapeSource id="highlightedSource" shape={highlightedTraceGeoJSON}>
          <LineLayer
            id="highlightedLine"
            style={{
              lineColor: colors.chartCyan, // Cyan for highlighted activity (same as RouteMapView)
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}

      {/* Start marker */}
      {startPoint && (
        <MarkerView coordinate={[startPoint.lng, startPoint.lat]}>
          <View style={styles.markerContainer}>
            <View style={[styles.marker, styles.startMarker]}>
              <MaterialCommunityIcons name="play" size={12} color={colors.textOnDark} />
            </View>
          </View>
        </MarkerView>
      )}

      {/* End marker */}
      {endPoint && (
        <MarkerView coordinate={[endPoint.lng, endPoint.lat]}>
          <View style={styles.markerContainer}>
            <View style={[styles.marker, styles.endMarker]}>
              <MaterialCommunityIcons name="flag-checkered" size={12} color={colors.textOnDark} />
            </View>
          </View>
        </MarkerView>
      )}
    </MapView>
  );

  const handleMapPress = useCallback(() => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    }
  }, [enableFullscreen]);

  const closeFullscreen = useCallback(() => {
    setIsFullscreen(false);
  }, []);

  // Section coordinates for BaseMapView [lng, lat] format
  const sectionCoords = useMemo(() => {
    return displayPoints.map((p) => [p.lng, p.lat] as [number, number]);
  }, [displayPoints]);

  const isDark = isDarkStyle(mapStyle);

  // When interactive, don't wrap in TouchableOpacity (would intercept zoom/pan gestures)
  // Instead show a dedicated fullscreen button
  const showExpandButton = enableFullscreen && interactive;
  const showExpandOverlay = enableFullscreen && !interactive;

  return (
    <>
      {interactive ? (
        // Interactive map - no TouchableOpacity wrapper, use dedicated button for fullscreen
        <View style={[styles.container, { height }]}>
          {mapContent}
          {showExpandButton && (
            <TouchableOpacity style={styles.expandButton} onPress={handleMapPress}>
              <MaterialCommunityIcons name="fullscreen" size={20} color={colors.textOnDark} />
            </TouchableOpacity>
          )}
        </View>
      ) : (
        // Non-interactive map - tap anywhere to fullscreen
        <TouchableOpacity
          style={[styles.container, { height }]}
          onPress={handleMapPress}
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
          initialStyle={mapStyle}
          onClose={closeFullscreen}
        >
          {/* Shadow track (full activity route) - rendered first so it's behind */}
          {shadowGeoJSON && (
            <ShapeSource id="fullscreenShadowSource" shape={shadowGeoJSON}>
              <LineLayer
                id="fullscreenShadowLine"
                style={{
                  lineColor: colors.gray500,
                  lineOpacity: 0.5,
                  lineWidth: 3,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </ShapeSource>
          )}

          {/* Pre-loaded activity traces with filter (fast scrubbing) */}
          {allTracesFeatureCollection && (
            <ShapeSource id="fullscreenAllTracesSource" shape={allTracesFeatureCollection}>
              <LineLayer
                id="fullscreenAllTracesLine"
                filter={highlightedTraceFilter}
                style={{
                  lineColor: colors.chartCyan,
                  lineWidth: 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </ShapeSource>
          )}

          {/* Highlighted lap points overlay */}
          {highlightedLapGeoJSON && (
            <ShapeSource id="fullscreenHighlightedLapSource" shape={highlightedLapGeoJSON}>
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
          )}

          {/* Fallback: Highlighted activity trace (when allActivityTraces not provided) */}
          {highlightedTraceGeoJSON && (
            <ShapeSource id="fullscreenHighlightedSource" shape={highlightedTraceGeoJSON}>
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
          )}

          {/* Start marker */}
          {startPoint && (
            <MarkerView coordinate={[startPoint.lng, startPoint.lat]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.startMarker]}>
                  <MaterialCommunityIcons name="play" size={14} color={colors.textOnDark} />
                </View>
              </View>
            </MarkerView>
          )}

          {/* End marker */}
          {endPoint && (
            <MarkerView coordinate={[endPoint.lng, endPoint.lat]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.endMarker]}>
                  <MaterialCommunityIcons
                    name="flag-checkered"
                    size={14}
                    color={colors.textOnDark}
                  />
                </View>
              </View>
            </MarkerView>
          )}
        </BaseMapView>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
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
    width: 24,
    height: 24,
    borderRadius: layout.borderRadius,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.textOnDark,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  startMarker: {
    backgroundColor: colors.success,
  },
  endMarker: {
    backgroundColor: colors.error,
  },
  expandOverlay: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 6,
    padding: spacing.xs,
  },
  expandButton: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 6,
    padding: spacing.xs,
  },
});
