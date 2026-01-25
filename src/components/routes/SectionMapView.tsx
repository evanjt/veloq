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
  GeoJSONSource,
  LineLayer,
  MarkerView,
  type LngLatBounds,
  type Expression,
} from '@maplibre/maplibre-react-native';
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
  const highlightedTraceFilter = useMemo((): Expression | undefined => {
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
      logo={false}
      attribution={false}
      compass={interactive}
      dragPan={interactive}
      touchAndDoubleTapZoom={interactive}
      touchRotate={interactive}
      touchPitch={false}
    >
      <Camera
        initialViewState={{
          bounds: [bounds.sw[0], bounds.sw[1], bounds.ne[0], bounds.ne[1]] as LngLatBounds,
          padding: { top: 40, right: 40, bottom: 40, left: 40 },
        }}
      />

      {/* Shadow track (full activity route) */}
      {/* CRITICAL: Always render all GeoJSONSources to avoid iOS crash during view reconciliation */}
      {/* Shadow track (full activity route) */}
      <GeoJSONSource id="shadowSource" data={shadowGeoJSON}>
        <LineLayer
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

      {/* Section polyline */}
      <GeoJSONSource id="sectionSource" data={sectionGeoJSON}>
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
      </GeoJSONSource>

      {/* Pre-loaded activity traces with filter */}
      <GeoJSONSource id="allTracesSource" data={allTracesFeatureCollection}>
        <LineLayer
          id="allTracesLine"
          filter={highlightedTraceFilter}
          style={{
            lineColor: colors.chartCyan,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: !isScrubbing && hasAllTraces && highlightedTraceFilter ? 1 : 0,
          }}
        />
      </GeoJSONSource>

      {/* Highlighted lap points overlay */}
      <GeoJSONSource id="highlightedLapSource" data={highlightedLapGeoJSON}>
        <LineLayer
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
        <LineLayer
          id="highlightedLine"
          style={{
            lineColor: colors.chartCyan,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: !isScrubbing ? 1 : 0,
          }}
        />
      </GeoJSONSource>

      {/* Start marker - keep conditional as MarkerViews need valid coordinates */}
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
          {/* CRITICAL: Always render all GeoJSONSources to avoid iOS crash */}
          {/* Shadow track (full activity route) */}
          <GeoJSONSource id="fullscreenShadowSource" data={shadowGeoJSON}>
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
          </GeoJSONSource>

          {/* Pre-loaded activity traces with filter */}
          <GeoJSONSource id="fullscreenAllTracesSource" data={allTracesFeatureCollection}>
            <LineLayer
              id="fullscreenAllTracesLine"
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
          <GeoJSONSource id="fullscreenHighlightedLapSource" data={highlightedLapGeoJSON}>
            <LineLayer
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
            <LineLayer
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
