/**
 * Hero map view for route detail page.
 * Displays the consensus route prominently with faded individual traces behind.
 * The consensus route is the "common core" that 80%+ of activities pass through.
 * Supports interaction (zoom/pan) and fullscreen mode like ActivityMapView.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, StatusBar } from 'react-native';
import { CircleLayer, LineLayer, ShapeSource } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor } from '@/features/activity/lib/activityUtils';
import { colors, mapLayerColors, spacing, layout } from '@/theme';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import { BaseMapView, isDarkStyle, MapSurface } from '@/features/maps/components';
import {
  boundsOfLngLat,
  featureCollection,
  lineFeature,
  lngLatFromShort,
  pointFeature,
} from '@/features/maps/lib/coordinates';
import type { MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
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

const FIT_PADDING = 40;

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

  const displayPoints = routeGroup.signature?.points ?? [];
  const routeCoords = useMemo(() => lngLatFromShort(displayPoints), [displayPoints]);

  // 10% padding leaves room for traces that stray outside the consensus line.
  const bounds = useMemo(() => boundsOfLngLat(routeCoords, 0.1), [routeCoords]);

  const activityTraces = useMemo(
    () =>
      Object.entries(activitySignatures)
        .filter(([, signature]) => signature.points && signature.points.length > 1)
        .map(([id, signature]) => ({ id, points: lngLatFromShort(signature.points) })),
    [activitySignatures]
  );

  const fadedTraces = useMemo(
    () =>
      featureCollection(
        activityTraces
          .filter((trace) => trace.id !== highlightedActivityId)
          .map((trace) => lineFeature(trace.points, { id: trace.id }))
      ),
    [activityTraces, highlightedActivityId]
  );

  // A lap selection wins over a whole-activity selection.
  const highlightedTrace = useMemo(() => {
    const lapCoords = highlightedLapPoints ? lngLatFromShort(highlightedLapPoints) : [];
    if (lapCoords.length > 1) {
      return featureCollection([lineFeature(lapCoords, { id: 'lap' })]);
    }
    const activity = activityTraces.find((trace) => trace.id === highlightedActivityId);
    if (activity) {
      return featureCollection([lineFeature(activity.points, { id: activity.id })]);
    }
    return featureCollection([]);
  }, [activityTraces, highlightedActivityId, highlightedLapPoints]);

  const routeLine = useMemo(() => featureCollection([lineFeature(routeCoords)]), [routeCoords]);

  // Markers follow whatever is highlighted, falling back to the route itself.
  const endpoints = useMemo(() => {
    const lapCoords = highlightedLapPoints ? lngLatFromShort(highlightedLapPoints) : [];
    const source =
      lapCoords.length > 1
        ? lapCoords
        : (activityTraces.find((trace) => trace.id === highlightedActivityId)?.points ??
          routeCoords);
    if (source.length === 0) return featureCollection([]);
    return featureCollection([
      pointFeature(source[0], { position: 'start' }),
      pointFeature(source[source.length - 1], { position: 'end' }),
    ]);
  }, [activityTraces, highlightedActivityId, highlightedLapPoints, routeCoords]);

  const sources = useMemo<Record<string, MapSourceSpec>>(
    () => ({
      'faded-traces': { kind: 'geojson', data: fadedTraces },
      route: { kind: 'geojson', data: routeLine },
      'highlighted-trace': { kind: 'geojson', data: highlightedTrace },
      endpoints: { kind: 'geojson', data: endpoints },
    }),
    [fadedTraces, routeLine, highlightedTrace, endpoints]
  );

  // Highlighting one activity pushes everything else back rather than hiding it.
  const consensusOpacity = highlightedActivityId ? 0.3 : 1;
  const fadedOpacity = highlightedActivityId ? 0.1 : 0.2;

  const layers = useMemo<MapLayerSpec[]>(
    () => buildRouteLayers({ activityColor, consensusOpacity, fadedOpacity }),
    [activityColor, consensusOpacity, fadedOpacity]
  );

  const handleMapPress = useCallback(() => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    } else if (onPress) {
      onPress();
    }
  }, [enableFullscreen, onPress]);

  const closeFullscreen = useCallback(() => setIsFullscreen(false), []);

  const isDark = isDarkStyle(mapStyle);

  if (!bounds || displayPoints.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  const showExpandIcon = enableFullscreen && !interactive;

  return (
    <>
      <TouchableOpacity
        testID="route-map-container"
        style={[styles.container, { height }]}
        onPress={handleMapPress}
        activeOpacity={enableFullscreen || onPress ? 0.9 : 1}
        disabled={!enableFullscreen && !onPress}
      >
        <MapSurface
          mapStyle={mapStyle}
          styleOptions={SURFACE_STYLE_OPTIONS}
          initialCamera={{ bounds, padding: FIT_PADDING }}
          sources={sources}
          layers={layers}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          rotateEnabled={interactive}
          onPress={onPress ? () => onPress() : undefined}
        />
        {showExpandIcon && (
          <View style={styles.expandOverlay}>
            <MaterialCommunityIcons name="fullscreen" size={20} color={colors.textOnDark} />
          </View>
        )}
      </TouchableOpacity>

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
          bounds={bounds ?? undefined}
          initialStyle={mapStyle}
          onClose={closeFullscreen}
        >
          <ShapeSource id="fadedTracesSource" shape={fadedTraces}>
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

          <ShapeSource id="highlightedSource" shape={highlightedTrace}>
            <LineLayer
              id="highlightedLineCasing"
              style={{
                lineColor: mapLayerColors.casing,
                lineOpacity: 0.5,
                lineWidth: 7,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="highlightedLine"
              style={{
                lineColor: colors.chartCyan,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>

          <ShapeSource id="endpointsSource" shape={endpoints}>
            <CircleLayer
              id="endpointBorder"
              style={{ circleRadius: 7.5, circleColor: mapLayerColors.casing }}
            />
            <CircleLayer
              id="endpointFill"
              style={{
                circleRadius: 6,
                circleColor: [
                  'case',
                  ['==', ['get', 'position'], 'start'],
                  mapLayerColors.start,
                  mapLayerColors.end,
                ],
              }}
            />
          </ShapeSource>
        </BaseMapView>
      </Modal>
    </>
  );
}

const SURFACE_STYLE_OPTIONS = { bundledLightStyle: true, cacheVectorTiles: true } as const;

/**
 * Layer stack, back to front: other attempts, then the consensus route, then
 * whatever the caller singled out, then the endpoint dots.
 */
function buildRouteLayers({
  activityColor,
  consensusOpacity,
  fadedOpacity,
}: {
  activityColor: string;
  consensusOpacity: number;
  fadedOpacity: number;
}): MapLayerSpec[] {
  return [
    {
      id: 'faded-traces-line',
      type: 'line',
      source: 'faded-traces',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': activityColor,
        'line-opacity': fadedOpacity,
        'line-width': 2,
      },
    },
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapLayerColors.casing,
        'line-opacity': consensusOpacity,
        'line-width': 5,
      },
    },
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': activityColor,
        'line-opacity': consensusOpacity,
        'line-width': 4,
      },
    },
    {
      id: 'highlighted-casing',
      type: 'line',
      source: 'highlighted-trace',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': mapLayerColors.casing, 'line-width': 5 },
    },
    {
      id: 'highlighted-line',
      type: 'line',
      source: 'highlighted-trace',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.chartCyan, 'line-width': 4 },
    },
    {
      id: 'endpoint-border',
      type: 'circle',
      source: 'endpoints',
      paint: { 'circle-radius': 7.5, 'circle-color': mapLayerColors.casing },
    },
    {
      id: 'endpoint-fill',
      type: 'circle',
      source: 'endpoints',
      paint: {
        'circle-radius': 6,
        'circle-color': [
          'case',
          ['==', ['get', 'position'], 'start'],
          mapLayerColors.start,
          mapLayerColors.end,
        ],
      },
    },
  ];
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: layout.borderRadius,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadius,
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
