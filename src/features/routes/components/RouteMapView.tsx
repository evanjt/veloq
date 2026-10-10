/**
 * Hero map view for route detail page.
 * Displays the representative activity's route with faded individual traces behind.
 * Supports interaction (zoom/pan) and fullscreen mode like ActivityMapView.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, Modal, StatusBar } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from 'expo-router';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { getActivityColor } from '@/shared/activity/activityUtils';
import { colors, mapLayerColors, spacing, layout, colorWithOpacity, ink } from '@/theme';
import { useMapPreferences } from '@/features/settings';
import {
  BaseMapView,
  type BaseMap3DLayer,
  boundsOfLngLat,
  buildDeltaLineStops,
  featureCollection,
  isDarkStyle,
  lineFeature,
  lngLatFromShort,
  type MapLayerSpec,
  type MapSourceSpec,
  MapSurface,
  pointFeature,
  useDrawnMapStyle,
} from '@/features/maps';
import type { ActivityType, RouteGroup, RoutePoint } from '@/types';
import type { SectionDeltaLine } from '../lib/deltaLayout';

/** Minimal route group type for map display - only needs points and distance for signature */
type RouteGroupForMap = Omit<RouteGroup, 'signature'> & {
  signature?: { points: RoutePoint[]; distance: number } | null | undefined;
};

interface RouteMapViewProps {
  routeGroup: RouteGroupForMap;
  selectedSportType?: ActivityType | undefined;
  height?: number | undefined;
  /** Enable map interaction (zoom, pan). Default false for preview, true for detail. */
  interactive?: boolean | undefined;
  /** Activity ID to highlight (show prominently while others fade) */
  highlightedActivityId?: string | null | undefined;
  /** Specific lap points to highlight (takes precedence over highlightedActivityId) */
  highlightedLapPoints?: RoutePoint[] | undefined;
  /** Enable tap to fullscreen */
  enableFullscreen?: boolean | undefined;
  /** Callback when map is tapped (only if enableFullscreen is false) */
  onPress?: (() => void) | undefined;
  /** Activity signatures for trace rendering (activity ID -> points) */
  activitySignatures?: Record<string, { points: RoutePoint[] }> | undefined;
  /** The attempt the chart's delta plot shows, which colours the route line. */
  deltaLine?: SectionDeltaLine | null | undefined;
}

const FIT_PADDING = 40;

export function RouteMapView({
  routeGroup,
  selectedSportType,
  height = 200,
  interactive = false,
  highlightedActivityId = null,
  highlightedLapPoints,
  enableFullscreen = false,
  onPress,
  activitySignatures = {},
  deltaLine = null,
}: RouteMapViewProps) {
  const { t } = useTranslation();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const screenFocused = useIsFocused();
  const { getStyleForActivity, preferences } = useMapPreferences();
  const chosenStyle = selectedSportType
    ? getStyleForActivity(selectedSportType)
    : preferences.defaultStyle;
  const mapStyle = useDrawnMapStyle(chosenStyle);
  const activityColor = getActivityColor(selectedSportType ?? 'Other');

  // Memoised so the empty fallback is one array rather than a fresh one each
  // render, which recomputed every projection below it.
  const points = routeGroup.signature?.points;
  const displayPoints = useMemo(() => points ?? [], [points]);
  const routeCoords = useMemo(() => lngLatFromShort(displayPoints), [displayPoints]);

  // 10% padding leaves room for traces that stray outside the representative line.
  const bounds = useMemo(() => boundsOfLngLat(routeCoords, 0.1), [routeCoords]);

  const activityTraces = useMemo(
    () =>
      Object.entries(activitySignatures)
        .filter(([, signature]) => signature.points && signature.points.length > 1)
        .map(([id, signature]) => ({
          id,
          points: lngLatFromShort(signature.points),
        })),
    [activitySignatures]
  );

  const fadedTraces = useMemo(
    () =>
      featureCollection(activityTraces.map((trace) => lineFeature(trace.points, { id: trace.id }))),
    [activityTraces]
  );

  // The highlighted attempt is drawn by its own source, so the faded layer
  // skips it by filter and the collection above stays the same across a scrub.
  const fadedFilter = useMemo<unknown[] | undefined>(
    () => (highlightedActivityId ? ['!=', ['get', 'id'], highlightedActivityId] : undefined),
    [highlightedActivityId]
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

  const deltaLineStops = useMemo(
    () =>
      deltaLine
        ? buildDeltaLineStops(
            deltaLine.splits,
            deltaLine.splitStepM,
            deltaLine.sectionLengthM,
            deltaLine.direction
          )
        : null,
    [deltaLine]
  );

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

  // Fullscreen reuses everything except the route itself, which BaseMapView
  // already draws from the coordinates it is given.
  const overlaySources = useMemo<Record<string, MapSourceSpec>>(
    () => ({
      'faded-traces': { kind: 'geojson', data: fadedTraces },
      'highlighted-trace': { kind: 'geojson', data: highlightedTrace },
      endpoints: { kind: 'geojson', data: endpoints },
    }),
    [fadedTraces, highlightedTrace, endpoints]
  );

  const sources = useMemo(
    () => buildRouteSources(overlaySources, routeLine),
    [overlaySources, routeLine]
  );

  // Highlighting one activity pushes everything else back rather than hiding it.
  const representativeOpacity = highlightedActivityId ? 0.3 : 1;
  const fadedOpacity = highlightedActivityId ? 0.1 : 0.2;

  const layers = useMemo<MapLayerSpec[]>(
    () =>
      buildRouteLayers({
        activityColor,
        representativeOpacity,
        fadedOpacity,
        fadedFilter,
        includeRoute: true,
        deltaLineStops,
      }),
    [activityColor, representativeOpacity, fadedOpacity, fadedFilter, deltaLineStops]
  );

  // Fullscreen has room to show the other attempts at full strength. Its shell
  // draws the route itself and carries no delta colouring.
  const fullscreenLayers = useMemo<MapLayerSpec[]>(
    () =>
      buildRouteLayers({
        activityColor,
        representativeOpacity: 1,
        fadedOpacity: FULLSCREEN_FADED_OPACITY,
        fadedFilter,
        includeRoute: false,
      }),
    [activityColor, fadedFilter]
  );

  const fullscreenLayer3D = useMemo(
    () =>
      buildRoute3DLayer({ fadedTraces, highlightedTrace, highlightedActivityId, activityColor }),
    [fadedTraces, highlightedTrace, highlightedActivityId, activityColor]
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
      <Pressable
        testID="route-map-container"
        style={pressable([styles.container, { height }])}
        onPress={handleMapPress}
        accessibilityRole="button"
        accessibilityLabel={t('maps.openFullscreen')}
        accessibilityState={{ disabled: !enableFullscreen && !onPress }}
        disabled={!enableFullscreen && !onPress}
        android_ripple={pressRipple}
      >
        <MapSurface
          mapStyle={mapStyle}
          initialCamera={{ bounds, padding: FIT_PADDING }}
          sources={sources}
          layers={layers}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          rotateEnabled={interactive}
          // The fullscreen map covers the hero, so the hero holds no map under it.
          released={!screenFocused || isFullscreen}
          onPress={onPress ? () => onPress() : undefined}
        />
        {showExpandIcon && (
          <View style={styles.expandOverlay}>
            <MaterialCommunityIcons name="fullscreen" size={20} color={colors.textOnDark} />
          </View>
        )}
      </Pressable>

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
          initialStyle={chosenStyle}
          onClose={closeFullscreen}
          overlaySources={overlaySources}
          overlayLayers={fullscreenLayers}
          layer3D={fullscreenLayer3D}
        />
      </Modal>
    </>
  );
}

/** The fullscreen map's faded attempts, the strength `fullscreenLayers` gives them. */
const FULLSCREEN_FADED_OPACITY = 0.2;

/**
 * The fullscreen overlays as the 3D page takes them. The page has no faded
 * trace collection, so the other attempts go in its sections collection, the
 * one that takes a colour per feature, faded there to the strength the flat
 * map gives them and without the highlighted attempt, which draws in its own.
 */
export function buildRoute3DLayer({
  fadedTraces,
  highlightedTrace,
  highlightedActivityId,
  activityColor,
}: {
  fadedTraces: GeoJSON.FeatureCollection;
  highlightedTrace: GeoJSON.FeatureCollection;
  highlightedActivityId: string | null;
  activityColor: string;
}): BaseMap3DLayer {
  const color = colorWithOpacity(activityColor, FULLSCREEN_FADED_OPACITY);
  return {
    sectionsGeoJSON: {
      type: 'FeatureCollection',
      features: fadedTraces.features
        .filter((f) => !highlightedActivityId || f.properties?.id !== highlightedActivityId)
        .map((f) => ({ ...f, properties: { ...f.properties, color } })),
    },
    highlightedTraceGeoJSON: highlightedTrace,
  };
}

/**
 * The inline map's sources: the overlays and the route itself. line-gradient
 * addresses the route by line-progress, which needs line metrics.
 */
export function buildRouteSources(
  overlaySources: Record<string, MapSourceSpec>,
  routeLine: GeoJSON.FeatureCollection
): Record<string, MapSourceSpec> {
  return { ...overlaySources, route: { kind: 'geojson', data: routeLine, lineMetrics: true } };
}

/**
 * Layer stack, back to front: other attempts, then the representative route, then
 * whatever the caller singled out, then the endpoint dots.
 */
export function buildRouteLayers({
  activityColor,
  representativeOpacity,
  fadedOpacity,
  fadedFilter,
  includeRoute,
  deltaLineStops = null,
}: {
  activityColor: string;
  representativeOpacity: number;
  fadedOpacity: number;
  /** Hides the highlighted attempt from the faded layer. */
  fadedFilter: unknown[] | undefined;
  /** Off in fullscreen, where the shell draws the route itself. */
  includeRoute: boolean;
  /**
   * `line-progress` stops colouring the route line by time won or lost, while
   * the chart shows the delta plot. Without them the line keeps `activityColor`.
   */
  deltaLineStops?: (string | number)[] | null;
}): MapLayerSpec[] {
  const routeLayers: MapLayerSpec[] = includeRoute
    ? [
        {
          id: 'route-casing',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': mapLayerColors.casing,
            'line-opacity': representativeOpacity,
            'line-width': 5,
          },
        },
        {
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            ...(deltaLineStops
              ? {
                  'line-gradient': [
                    'interpolate',
                    ['linear'],
                    ['line-progress'],
                    ...deltaLineStops,
                  ],
                }
              : { 'line-color': activityColor }),
            'line-opacity': representativeOpacity,
            'line-width': 4,
          },
        },
      ]
    : [];

  return [
    {
      id: 'faded-traces-line',
      type: 'line',
      source: 'faded-traces',
      filter: fadedFilter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': activityColor,
        'line-opacity': fadedOpacity,
        'line-width': 2,
      },
    },
    ...routeLayers,
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
    backgroundColor: colorWithOpacity(ink.black, 0.5),
    borderRadius: layout.borderRadiusSm,
    padding: spacing.xs,
  },
});
