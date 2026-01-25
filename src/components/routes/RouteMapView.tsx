/**
 * Hero map view for route detail page.
 * Displays the consensus route prominently with faded individual traces behind.
 * The consensus route is the "common core" that 80%+ of activities pass through.
 * Supports interaction (zoom/pan) and fullscreen mode like ActivityMapView.
 */

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, StatusBar } from 'react-native';
import {
  MapView,
  Camera,
  GeoJSONSource,
  LineLayer,
  MarkerView,
  type LngLatBounds,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor, getBoundsFromPoints } from '@/lib';
import { colors, spacing, layout } from '@/theme';
import { useMapPreferences } from '@/providers';
import { getMapStyle, BaseMapView, isDarkStyle } from '@/components/maps';
import type { RouteGroup, RoutePoint } from '@/types';

/** Minimal route group type for map display - only needs points and distance for signature */
type RouteGroupForMap = Omit<RouteGroup, 'signature'> & {
  signature?: { points: RoutePoint[]; distance: number } | null;
};

interface RouteMapViewProps {
  routeGroup: RouteGroupForMap;
  height?: number;
  /** Enable map interaction (zoom, pan). Default false for preview, true for detail. */
  interactive?: boolean;
  /** Activity ID to highlight (show prominently while others fade) */
  highlightedActivityId?: string | null;
  /** Specific lap points to highlight (takes precedence over highlightedActivityId) */
  highlightedLapPoints?: RoutePoint[];
  /** Enable tap to fullscreen */
  enableFullscreen?: boolean;
  /** Callback when map is tapped (only if enableFullscreen is false) */
  onPress?: () => void;
  /** Activity signatures for trace rendering (activity ID -> points) */
  activitySignatures?: Record<string, { points: RoutePoint[] }>;
}

export function RouteMapView({
  routeGroup,
  height = 200,
  interactive = false,
  highlightedActivityId = null,
  highlightedLapPoints,
  enableFullscreen = false,
  onPress,
  activitySignatures = {},
}: RouteMapViewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { getStyleForActivity } = useMapPreferences();
  const mapStyle = getStyleForActivity(routeGroup.type);
  const activityColor = getActivityColor(routeGroup.type);
  const mapRef = useRef(null);

  // Build activity traces from signatures prop
  const activityTracesWithIds = useMemo(() => {
    return Object.entries(activitySignatures)
      .filter(([_, sig]) => sig.points && sig.points.length > 1)
      .map(([id, sig]) => ({ id, points: sig.points }));
  }, [activitySignatures]);

  // Always use the representative signature (the full route)
  // Consensus points are only for internal lap detection, not for display
  const displayPoints = routeGroup.signature?.points || [];

  // Calculate bounds from the representative route (10% padding for traces)
  const bounds = useMemo(() => getBoundsFromPoints(displayPoints, 0.1), [displayPoints]);

  // Helper to filter and convert points to GeoJSON coordinates, removing invalid values
  const toValidCoordinates = (points: RoutePoint[]): [number, number][] =>
    points
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => [p.lng, p.lat]);

  // Minimal valid geometry for iOS crash prevention
  // Using a real LineString at [0,0] instead of empty features to avoid MapLibre warnings
  const EMPTY_LINE_GEOJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0, 0.0001],
          ],
        },
      },
    ],
  };

  // Create GeoJSON for individual activity traces - split into highlighted and non-highlighted
  // iOS crash fix: Always return valid GeoJSON, never null
  const { fadedTracesGeoJSON, highlightedTraceGeoJSON, hasFadedTraces, hasHighlightedTrace } =
    useMemo(() => {
      if (activityTracesWithIds.length === 0) {
        return {
          fadedTracesGeoJSON: EMPTY_LINE_GEOJSON,
          highlightedTraceGeoJSON: EMPTY_LINE_GEOJSON,
          hasFadedTraces: false,
          hasHighlightedTrace: false,
        };
      }

      // Check if we have lap-specific points to highlight (takes precedence)
      const hasLapHighlight = highlightedLapPoints && highlightedLapPoints.length > 1;

      // Separate highlighted trace from others
      const fadedTraces = activityTracesWithIds.filter((t) => t.id !== highlightedActivityId);
      const highlightedActivity = activityTracesWithIds.find((t) => t.id === highlightedActivityId);

      const fadedFeatures = fadedTraces
        .map((trace) => {
          const coords = toValidCoordinates(trace.points);
          if (coords.length < 2) return null;
          return {
            type: 'Feature' as const,
            properties: { id: trace.id },
            geometry: {
              type: 'LineString' as const,
              coordinates: coords,
            },
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      const faded: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: fadedFeatures,
      };

      // Use lap points if available, otherwise use full activity trace
      let highlightedGeo: GeoJSON.FeatureCollection = EMPTY_LINE_GEOJSON;
      let hasHighlight = false;

      if (hasLapHighlight) {
        // Highlight specific lap section - filter out invalid points
        const coords = toValidCoordinates(highlightedLapPoints!);
        if (coords.length >= 2) {
          highlightedGeo = {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { id: 'lap' },
                geometry: {
                  type: 'LineString',
                  coordinates: coords,
                },
              },
            ],
          };
          hasHighlight = true;
        }
      } else if (highlightedActivity) {
        // Highlight full activity trace
        const coords = toValidCoordinates(highlightedActivity.points);
        if (coords.length >= 2) {
          highlightedGeo = {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { id: highlightedActivity.id },
                geometry: {
                  type: 'LineString',
                  coordinates: coords,
                },
              },
            ],
          };
          hasHighlight = true;
        }
      }

      return {
        fadedTracesGeoJSON: faded,
        highlightedTraceGeoJSON: highlightedGeo,
        hasFadedTraces: fadedFeatures.length > 0,
        hasHighlightedTrace: hasHighlight,
      };
    }, [activityTracesWithIds, highlightedActivityId, highlightedLapPoints]);

  // Create GeoJSON for the consensus/main route
  // GeoJSON LineString requires minimum 2 coordinates - invalid data causes iOS crash:
  // -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207)
  // iOS crash fix: Always return valid GeoJSON, use hasRouteData flag for visibility
  const { routeGeoJSON, hasRouteData } = useMemo(() => {
    // Filter out NaN/Infinity coordinates
    const validPoints = displayPoints.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    // LineString requires at least 2 valid coordinates
    if (validPoints.length < 2) {
      return {
        routeGeoJSON: EMPTY_LINE_GEOJSON,
        hasRouteData: false,
      };
    }
    return {
      routeGeoJSON: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: validPoints.map((p) => [p.lng, p.lat]),
            },
          },
        ],
      },
      hasRouteData: true,
    };
  }, [displayPoints]);

  const styleUrl = getMapStyle(mapStyle);

  // Helper to validate a point has valid numeric coordinates
  const isValidPoint = (p: RoutePoint | undefined): p is RoutePoint =>
    p != null && Number.isFinite(p.lat) && Number.isFinite(p.lng);

  // Determine which points to use for start/end markers
  // If an activity is highlighted, show that activity's actual start/end
  // Otherwise, show the route's start/end
  const markerPoints = useMemo(() => {
    // If we have highlighted lap points, use those
    if (highlightedLapPoints && highlightedLapPoints.length > 1) {
      const start = highlightedLapPoints[0];
      const end = highlightedLapPoints[highlightedLapPoints.length - 1];
      if (isValidPoint(start) && isValidPoint(end)) {
        return { start, end };
      }
    }

    // If we have a highlighted activity, find its trace and use those points
    if (highlightedActivityId) {
      const highlightedTrace = activityTracesWithIds.find((t) => t.id === highlightedActivityId);
      if (highlightedTrace && highlightedTrace.points.length > 1) {
        const start = highlightedTrace.points[0];
        const end = highlightedTrace.points[highlightedTrace.points.length - 1];
        if (isValidPoint(start) && isValidPoint(end)) {
          return { start, end };
        }
      }
    }

    // Default to route's start/end
    const start = displayPoints[0];
    const end = displayPoints[displayPoints.length - 1];
    return {
      start: isValidPoint(start) ? start : undefined,
      end: isValidPoint(end) ? end : undefined,
    };
  }, [highlightedLapPoints, highlightedActivityId, activityTracesWithIds, displayPoints]);

  const startPoint = markerPoints.start;
  const endPoint = markerPoints.end;

  // Handle map press - either open fullscreen or call custom handler
  // NOTE: All hooks must be called before any early returns
  const handleMapPress = useCallback(() => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    } else if (onPress) {
      onPress();
    }
  }, [enableFullscreen, onPress]);

  const closeFullscreen = useCallback(() => {
    setIsFullscreen(false);
  }, []);

  // Route coordinates for BaseMapView [lng, lat] format
  const routeCoords = useMemo(() => {
    return displayPoints.map((p) => [p.lng, p.lat] as [number, number]);
  }, [displayPoints]);

  const isDark = isDarkStyle(mapStyle);

  if (!bounds || displayPoints.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  // Determine opacity for consensus line based on whether an activity is highlighted
  const consensusOpacity = highlightedActivityId ? 0.3 : 1;
  const fadedOpacity = highlightedActivityId ? 0.1 : 0.2;

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
      onPress={onPress}
    >
      <Camera
        initialViewState={{
          bounds: [bounds.sw[0], bounds.sw[1], bounds.ne[0], bounds.ne[1]] as LngLatBounds,
          padding: { top: 40, right: 40, bottom: 40, left: 40 },
        }}
      />

      {/* Faded individual activity traces (render first, behind everything) */}
      {/* iOS crash fix: Always render GeoJSONSource, control visibility via opacity */}
      <GeoJSONSource id="fadedTracesSource" data={fadedTracesGeoJSON}>
        <LineLayer
          id="fadedTracesLine"
          style={{
            lineColor: activityColor,
            lineOpacity: hasFadedTraces ? fadedOpacity : 0,
            lineWidth: 2,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </GeoJSONSource>

      {/* Consensus/main route line */}
      {/* iOS crash fix: Always render GeoJSONSource */}
      <GeoJSONSource id="routeSource" data={routeGeoJSON}>
        <LineLayer
          id="routeLine"
          style={{
            lineColor: activityColor,
            lineOpacity: hasRouteData ? consensusOpacity : 0,
            lineWidth: 4,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </GeoJSONSource>

      {/* Highlighted activity trace (render on top, most prominent) */}
      {/* iOS crash fix: Always render GeoJSONSource */}
      <GeoJSONSource id="highlightedSource" data={highlightedTraceGeoJSON}>
        <LineLayer
          id="highlightedLine"
          style={{
            lineColor: colors.chartCyan, // Cyan for highlighted activity
            lineOpacity: hasHighlightedTrace ? 1 : 0,
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

  // Show fullscreen expand icon if enableFullscreen is true
  const showExpandIcon = enableFullscreen && !interactive;

  return (
    <>
      <TouchableOpacity
        style={[styles.container, { height }]}
        onPress={handleMapPress}
        activeOpacity={enableFullscreen || onPress ? 0.9 : 1}
        disabled={!enableFullscreen && !onPress}
      >
        {mapContent}
        {/* Expand icon overlay */}
        {showExpandIcon && (
          <View style={styles.expandOverlay}>
            <MaterialCommunityIcons name="fullscreen" size={20} color={colors.textOnDark} />
          </View>
        )}
      </TouchableOpacity>

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
          bounds={bounds || undefined}
          initialStyle={mapStyle}
          onClose={closeFullscreen}
        >
          {/* Faded activity traces - iOS crash fix: always render */}
          <GeoJSONSource id="fadedTracesSource" data={fadedTracesGeoJSON}>
            <LineLayer
              id="fadedTracesLine"
              style={{
                lineColor: activityColor,
                lineOpacity: hasFadedTraces ? 0.2 : 0,
                lineWidth: 2,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </GeoJSONSource>

          {/* Highlighted trace - iOS crash fix: always render */}
          <GeoJSONSource id="highlightedSource" data={highlightedTraceGeoJSON}>
            <LineLayer
              id="highlightedLine"
              style={{
                lineColor: colors.chartCyan,
                lineOpacity: hasHighlightedTrace ? 1 : 0,
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
}

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
});
