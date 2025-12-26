/**
 * Hero map view for route detail page.
 * Displays the consensus route prominently with faded individual traces behind.
 * The consensus route is the "common core" that 80%+ of activities pass through.
 * Supports interaction (zoom/pan) and fullscreen mode like ActivityMapView.
 */

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, StatusBar } from 'react-native';
import MapLibreGL, { Camera, ShapeSource, LineLayer, MarkerView } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor } from '@/lib';
import { colors, spacing, layout } from '@/theme';
import { useMapPreferences, useRouteMatchStore } from '@/providers';
import { getMapStyle, BaseMapView, isDarkStyle } from '@/components/maps';
import type { RouteGroup, RoutePoint } from '@/types';

const { MapView } = MapLibreGL;

interface RouteMapViewProps {
  routeGroup: RouteGroup;
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
}

export function RouteMapView({
  routeGroup,
  height = 200,
  interactive = false,
  highlightedActivityId = null,
  highlightedLapPoints,
  enableFullscreen = false,
  onPress,
}: RouteMapViewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { getStyleForActivity } = useMapPreferences();
  const mapStyle = getStyleForActivity(routeGroup.type);
  const activityColor = getActivityColor(routeGroup.type);
  const mapRef = useRef(null);

  // Get all signatures for activities in this group
  const signatures = useRouteMatchStore((s) => s.cache?.signatures || {});

  // Collect all activity traces with their IDs for highlighting
  const activityTracesWithIds = useMemo(() => {
    const traces: { id: string; points: RoutePoint[] }[] = [];
    for (const activityId of routeGroup.activityIds) {
      const sig = signatures[activityId];
      if (sig?.points && sig.points.length > 1) {
        traces.push({ id: activityId, points: sig.points });
      }
    }
    return traces;
  }, [routeGroup.activityIds, signatures]);

  // Always use the representative signature (the full route)
  // Consensus points are only for internal lap detection, not for display
  const displayPoints = routeGroup.signature?.points || [];

  // Calculate bounds from the representative route
  const bounds = useMemo(() => {
    const primaryPoints = displayPoints;
    if (primaryPoints.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const point of primaryPoints) {
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
      minLng = Math.min(minLng, point.lng);
      maxLng = Math.max(maxLng, point.lng);
    }

    // Add small padding for traces that slightly exceed consensus bounds
    const latPad = (maxLat - minLat) * 0.1;
    const lngPad = (maxLng - minLng) * 0.1;

    return {
      ne: [maxLng + lngPad, maxLat + latPad] as [number, number],
      sw: [minLng - lngPad, minLat - latPad] as [number, number],
    };
  }, [displayPoints]);

  // Create GeoJSON for individual activity traces - split into highlighted and non-highlighted
  const { fadedTracesGeoJSON, highlightedTraceGeoJSON } = useMemo(() => {
    if (activityTracesWithIds.length === 0) {
      return { fadedTracesGeoJSON: null, highlightedTraceGeoJSON: null };
    }

    // Check if we have lap-specific points to highlight (takes precedence)
    const hasLapHighlight = highlightedLapPoints && highlightedLapPoints.length > 1;

    // Separate highlighted trace from others
    const fadedTraces = activityTracesWithIds.filter(t => t.id !== highlightedActivityId);
    const highlightedActivity = activityTracesWithIds.find(t => t.id === highlightedActivityId);

    const faded = fadedTraces.length > 0 ? {
      type: 'FeatureCollection' as const,
      features: fadedTraces.map((trace, idx) => ({
        type: 'Feature' as const,
        properties: { id: trace.id },
        geometry: {
          type: 'LineString' as const,
          coordinates: trace.points.map(p => [p.lng, p.lat]),
        },
      })),
    } : null;

    // Use lap points if available, otherwise use full activity trace
    let highlightedGeo = null;
    if (hasLapHighlight) {
      // Highlight specific lap section
      highlightedGeo = {
        type: 'Feature' as const,
        properties: { id: 'lap' },
        geometry: {
          type: 'LineString' as const,
          coordinates: highlightedLapPoints!.map(p => [p.lng, p.lat]),
        },
      };
    } else if (highlightedActivity) {
      // Highlight full activity trace
      highlightedGeo = {
        type: 'Feature' as const,
        properties: { id: highlightedActivity.id },
        geometry: {
          type: 'LineString' as const,
          coordinates: highlightedActivity.points.map(p => [p.lng, p.lat]),
        },
      };
    }

    return { fadedTracesGeoJSON: faded, highlightedTraceGeoJSON: highlightedGeo };
  }, [activityTracesWithIds, highlightedActivityId, highlightedLapPoints]);

  // Create GeoJSON for the consensus/main route
  const routeGeoJSON = useMemo(() => {
    if (displayPoints.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: displayPoints.map(p => [p.lng, p.lat]),
      },
    };
  }, [displayPoints]);

  const styleUrl = getMapStyle(mapStyle);

  // Determine which points to use for start/end markers
  // If an activity is highlighted, show that activity's actual start/end
  // Otherwise, show the route's start/end
  const markerPoints = useMemo(() => {
    // If we have highlighted lap points, use those
    if (highlightedLapPoints && highlightedLapPoints.length > 1) {
      return {
        start: highlightedLapPoints[0],
        end: highlightedLapPoints[highlightedLapPoints.length - 1],
      };
    }

    // If we have a highlighted activity, find its trace and use those points
    if (highlightedActivityId) {
      const highlightedTrace = activityTracesWithIds.find(t => t.id === highlightedActivityId);
      if (highlightedTrace && highlightedTrace.points.length > 1) {
        return {
          start: highlightedTrace.points[0],
          end: highlightedTrace.points[highlightedTrace.points.length - 1],
        };
      }
    }

    // Default to route's start/end
    return {
      start: displayPoints[0],
      end: displayPoints[displayPoints.length - 1],
    };
  }, [highlightedLapPoints, highlightedActivityId, activityTracesWithIds, displayPoints]);

  const startPoint = markerPoints.start;
  const endPoint = markerPoints.end;

  if (!bounds || displayPoints.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons
          name="map-marker-off"
          size={32}
          color={activityColor}
        />
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
      logoEnabled={false}
      attributionEnabled={false}
      compassEnabled={interactive}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={false}
      onPress={onPress}
    >
      <Camera
        bounds={bounds}
        padding={{ paddingTop: 40, paddingRight: 40, paddingBottom: 40, paddingLeft: 40 }}
        animationDuration={0}
      />

      {/* Faded individual activity traces (render first, behind everything) */}
      {fadedTracesGeoJSON && (
        <ShapeSource id="fadedTracesSource" shape={fadedTracesGeoJSON}>
          <LineLayer
            id="fadedTracesLine"
            style={{
              lineColor: activityColor,
              lineOpacity: fadedOpacity,
              lineWidth: 2,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}

      {/* Consensus/main route line */}
      {routeGeoJSON && (
        <ShapeSource id="routeSource" shape={routeGeoJSON}>
          <LineLayer
            id="routeLine"
            style={{
              lineColor: activityColor,
              lineOpacity: consensusOpacity,
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}

      {/* Highlighted activity trace (render on top, most prominent) */}
      {highlightedTraceGeoJSON && (
        <ShapeSource id="highlightedSource" shape={highlightedTraceGeoJSON}>
          <LineLayer
            id="highlightedLine"
            style={{
              lineColor: '#00BCD4', // Cyan for highlighted activity
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
              <MaterialCommunityIcons name="play" size={12} color="#FFFFFF" />
            </View>
          </View>
        </MarkerView>
      )}

      {/* End marker */}
      {endPoint && (
        <MarkerView coordinate={[endPoint.lng, endPoint.lat]}>
          <View style={styles.markerContainer}>
            <View style={[styles.marker, styles.endMarker]}>
              <MaterialCommunityIcons name="flag-checkered" size={12} color="#FFFFFF" />
            </View>
          </View>
        </MarkerView>
      )}
    </MapView>
  );

  // Handle map press - either open fullscreen or call custom handler
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
    return displayPoints.map(p => [p.lng, p.lat] as [number, number]);
  }, [displayPoints]);

  const isDark = isDarkStyle(mapStyle);

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
            <MaterialCommunityIcons name="fullscreen" size={20} color="#FFFFFF" />
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
          {/* Faded activity traces */}
          {fadedTracesGeoJSON && (
            <ShapeSource id="fadedTracesSource" shape={fadedTracesGeoJSON}>
              <LineLayer
                id="fadedTracesLine"
                style={{
                  lineColor: activityColor,
                  lineOpacity: 0.2,
                  lineWidth: 2,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </ShapeSource>
          )}

          {/* Highlighted trace */}
          {highlightedTraceGeoJSON && (
            <ShapeSource id="highlightedSource" shape={highlightedTraceGeoJSON}>
              <LineLayer
                id="highlightedLine"
                style={{
                  lineColor: '#00BCD4',
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
                  <MaterialCommunityIcons name="play" size={14} color="#FFFFFF" />
                </View>
              </View>
            </MarkerView>
          )}

          {/* End marker */}
          {endPoint && (
            <MarkerView coordinate={[endPoint.lng, endPoint.lat]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.endMarker]}>
                  <MaterialCommunityIcons name="flag-checkered" size={14} color="#FFFFFF" />
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
