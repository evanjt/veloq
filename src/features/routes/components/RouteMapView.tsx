/**
 * Hero map view for route detail page.
 * Displays the representative activity's route with faded individual traces behind.
 * Supports interaction (zoom/pan) and fullscreen mode like ActivityMapView.
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeroHeaderBottom } from '@/shared/ui/useHeroHeaderBottom';
import { useTheme } from '@/shared/app';
import { useMapHeldFocus } from '@/shared/app/MapSheetHost';
import { getActivityColor } from '@/shared/activity/activityUtils';
import {
  cameraMove,
  colors,
  colorWithOpacity,
  iconSize,
  ink,
  layout,
  mapPalette,
  opacity,
  type MapPalette,
  spacing,
} from '@/theme';
import { useMapPreferences } from '@/features/settings';
import {
  BaseMapView,
  type BaseMap3DLayer,
  boundsOfLngLat,
  cutLineByProgress,
  DELTA_GAPS_SOURCE_ID,
  deltaLineBands,
  lineBandExpression,
  noDataRanges,
  ENDPOINT_IMAGES,
  featureCollection,
  lineFeature,
  lngLatFromShort,
  type MapEdgeInset,
  type MapLayerSpec,
  type MapSourceSpec,
  MapSurface,
  type MapSurfaceRef,
  pointFeature,
  statusBarStyleForMap,
  useDrawnMapStyle,
} from '@/features/maps';
import { buildRouteLayers, buildRouteSources } from './routeMapLayerSpecs';
import type { ActivityType, RouteGroup, RoutePoint } from '@/types';
import type { SectionDeltaLine } from '../lib/deltaLayout';
import { DetailMapLegend, hasLegendLayers, type DetailMapLegendLayers } from './DetailMapLegend';
import { Icon } from '@/shared/ui/Icon';
import { PressTarget } from '@/shared/ui/PressTarget';

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
  /** When the highlighted attempt was ridden, which the map key names it by. */
  highlightedActivityDate?: Date | undefined;
  /** The activity the page was opened from, the only one the key calls "This activity". */
  pageActivityId?: string | undefined;
  /** Enable tap to fullscreen */
  enableFullscreen?: boolean | undefined;
  /** Callback when map is tapped (only if enableFullscreen is false) */
  onPress?: (() => void) | undefined;
  /** Activity signatures for trace rendering (activity ID -> points) */
  activitySignatures?: Record<string, { points: RoutePoint[] }> | undefined;
  /** The attempt the chart's delta plot shows, which colours the route line. */
  deltaLine?: SectionDeltaLine | null | undefined;
  /**
   * The padding the route is fitted with, per edge, for a map partly covered by its sheet. A
   * change refits the route; with none the fit keeps one margin all round.
   */
  fitPadding?: MapEdgeInset | undefined;
}

export const ROUTE_MAP_FIT_PADDING = 40;

export function RouteMapView({
  routeGroup,
  selectedSportType,
  height = 200,
  interactive = false,
  highlightedActivityId = null,
  highlightedLapPoints,
  highlightedActivityDate,
  pageActivityId,
  enableFullscreen = false,
  onPress,
  activitySignatures = {},
  deltaLine = null,
  fitPadding,
}: RouteMapViewProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const headerBottom = useHeroHeaderBottom();
  const fullscreenInsets = useSafeAreaInsets();
  // A map in a host stays held under its own sheet and is released only under another screen.
  const screenFocused = useMapHeldFocus();
  const surfaceRef = useRef<MapSurfaceRef>(null);
  const { getStyleForActivity, preferences } = useMapPreferences();
  const chosenStyle = selectedSportType
    ? getStyleForActivity(selectedSportType)
    : preferences.defaultStyle;
  const mapStyle = useDrawnMapStyle(chosenStyle);
  const activityColor = getActivityColor(selectedSportType ?? 'Other');
  const palette = mapPalette(mapStyle);

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

  const deltaBands = useMemo(
    () =>
      deltaLine
        ? deltaLineBands(
            deltaLine.percents,
            deltaLine.splitStepM,
            deltaLine.sectionLengthM,
            deltaLine.direction
          )
        : null,
    [deltaLine]
  );
  const deltaGapsGeoJSON = useMemo(
    () => cutLineByProgress(routeCoords, noDataRanges(deltaBands)),
    [routeCoords, deltaBands]
  );
  // The fullscreen map draws the route as its own line, in the same ramp.
  const fullscreenGradient = useCallback(
    (fullscreenPalette: MapPalette) =>
      deltaBands ? lineBandExpression(deltaBands, fullscreenPalette) : null,
    [deltaBands]
  );

  const legendLayers: DetailMapLegendLayers = {
    showActivity: highlightedTrace.features.length > 0,
    showDelta: deltaBands !== null,
    showDeltaGaps: deltaGapsGeoJSON.features.length > 0,
  };
  const pickedAttempt = {
    activityId: highlightedActivityId,
    date: highlightedActivityDate,
    pageActivityId,
  };

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
      [DELTA_GAPS_SOURCE_ID]: { kind: 'geojson', data: deltaGapsGeoJSON },
    }),
    [fadedTraces, highlightedTrace, endpoints, deltaGapsGeoJSON]
  );

  const sources = useMemo(
    () => buildRouteSources(overlaySources, routeLine),
    [overlaySources, routeLine]
  );

  // Highlighting one activity turns the route itself into context, drawn in
  // the muted colour rather than hidden.
  const routeContext = highlightedActivityId !== null;

  const layers = useMemo<MapLayerSpec[]>(
    () =>
      buildRouteLayers({
        palette,
        routeContext,
        fadedFilter,
        includeRoute: true,
        deltaBands,
      }),
    [palette, routeContext, fadedFilter, deltaBands]
  );

  // The fullscreen shell draws the route itself, banded through its own gradient.
  const fullscreenLayers = useCallback(
    (fullscreenPalette: MapPalette) =>
      buildRouteLayers({
        palette: fullscreenPalette,
        routeContext,
        fadedFilter,
        includeRoute: false,
      }),
    [routeContext, fadedFilter]
  );

  const fullscreenLayer3D = useMemo(
    () =>
      buildRoute3DLayer({
        fadedTraces,
        highlightedTrace,
        highlightedActivityId,
        contextColor: palette.muted,
      }),
    [fadedTraces, highlightedTrace, highlightedActivityId, palette]
  );

  const handleMapPress = useCallback(() => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    } else if (onPress) {
      onPress();
    }
  }, [enableFullscreen, onPress]);

  const closeFullscreen = useCallback(() => setIsFullscreen(false), []);

  // The first fit is the surface's starting view, so only a later padding refits the route.
  const fittedPadding = useRef(fitPadding);
  useEffect(() => {
    if (!bounds || !fitPadding || fittedPadding.current === fitPadding) return;
    fittedPadding.current = fitPadding;
    surfaceRef.current?.fitBounds(bounds, fitPadding, cameraMove.move);
  }, [bounds, fitPadding]);

  if (!bounds || displayPoints.length === 0) {
    return (
      <View
        style={[
          styles.placeholder,
          { height, backgroundColor: colorWithOpacity(activityColor, opacity.tint2) },
        ]}
      >
        <Icon name="map-marker-off" size={iconSize.xl} color={activityColor} />
      </View>
    );
  }

  const showExpandIcon = enableFullscreen && !interactive;

  return (
    <>
      <PressTarget
        testID="route-map-container"
        style={[styles.container, { height }]}
        onPress={handleMapPress}
        accessibilityRole="button"
        accessibilityLabel={t('maps.openFullscreen')}
        accessibilityState={{ disabled: !enableFullscreen && !onPress }}
        disabled={!enableFullscreen && !onPress}
      >
        <MapSurface
          ref={surfaceRef}
          mapStyle={mapStyle}
          initialCamera={{ bounds, padding: fitPadding ?? ROUTE_MAP_FIT_PADDING }}
          sources={sources}
          layers={layers}
          images={ENDPOINT_IMAGES}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          rotateEnabled={interactive}
          // The fullscreen map covers the hero, so the hero holds no map under it.
          released={!screenFocused || isFullscreen}
          onPress={onPress ? () => onPress() : undefined}
        />
        {showExpandIcon ? (
          <View style={styles.expandOverlay}>
            <Icon name="fullscreen" size={iconSize.md} color={colors.textOnFill} />
          </View>
        ) : null}
        {/* The layers drawn over the route's own line, named. */}
        {hasLegendLayers(legendLayers) ? (
          <DetailMapLegend
            isDark={isDark}
            palette={palette}
            top={headerBottom + spacing.sm}
            testID="route-map-legend"
            pickedAttempt={pickedAttempt}
            {...legendLayers}
          />
        ) : null}
      </PressTarget>

      <FullWindowModal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <StatusBar barStyle={`${statusBarStyleForMap(mapStyle)}-content`} />
        <BaseMapView
          routeCoordinates={routeCoords}
          routeContext={routeContext}
          routeGradient={fullscreenGradient}
          bounds={bounds ?? undefined}
          initialStyle={chosenStyle}
          onClose={closeFullscreen}
          overlaySources={overlaySources}
          overlayLayers={fullscreenLayers}
          overlayImages={ENDPOINT_IMAGES}
          layer3D={fullscreenLayer3D}
        />
        {hasLegendLayers(legendLayers) ? (
          <DetailMapLegend
            isDark={isDark}
            palette={palette}
            top={fullscreenInsets.top + spacing.sm}
            testID="route-map-legend"
            pickedAttempt={pickedAttempt}
            {...legendLayers}
          />
        ) : null}
      </FullWindowModal>
    </>
  );
}

/**
 * The fullscreen overlays as the 3D page takes them. The page has no context
 * trace collection, so the other attempts go in its sections collection, the
 * one that takes a colour per feature, in the context colour the flat map
 * draws them in and without the highlighted attempt, which draws in its own.
 */
export function buildRoute3DLayer({
  fadedTraces,
  highlightedTrace,
  highlightedActivityId,
  contextColor,
}: {
  fadedTraces: GeoJSON.FeatureCollection;
  highlightedTrace: GeoJSON.FeatureCollection;
  highlightedActivityId: string | null;
  /** The base's muted colour, which the flat map draws the other attempts in. */
  contextColor: string;
}): BaseMap3DLayer {
  const color = contextColor;
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
    backgroundColor: colorWithOpacity(ink.black, opacity.disabled),
    borderRadius: layout.borderRadiusSm,
    padding: spacing.xs,
  },
});
