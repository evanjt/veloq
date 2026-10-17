import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import type { ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useTheme } from '@/shared/app';
import {
  boundsOfLngLat,
  circlePolygon,
  emptyGrowingLngLat,
  featureCollection,
  getNextStyle,
  growLngLat,
  lineFeature,
  type LngLat,
  lngLatFromShort,
  type MapLayerSpec,
  type MapSourceSpec,
  type MapStyleType,
  MapSurface,
  type MapSurfaceRef,
  useDrawnMapStyle,
  pointFeature,
  pointsBetweenSourceIndices,
} from '@/features/maps';
import {
  brand,
  cameraMove,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  opacity,
  recording,
  spacing,
  stroke,
} from '@/theme';
import type { LatLngShort } from '@/shared/geo/distance';

const EXCLUDED_COLOR = colorWithOpacity(colors.neutralLine, opacity.disabled);
const POSITION_DOT_COLOR = colors.secondary;
const POSITION_DOT_HALO = colors.surface;
const OVERLAY_COLOR = brand.blue;
const ACCURACY_RING_COLOR = colors.secondary;

/** Zoom held while the camera follows the current position. */
const FOLLOW_ZOOM = 15;

/**
 * The basemap the athlete cycled to while riding, or null for the theme's.
 *
 * Module-scoped rather than component state, because a recording is not a
 * screen visit: it runs for hours and the athlete leaves the tab and comes
 * back. A choice that died with the component would have to be made again with
 * gloves on, mid-ride. It is still not a preference: nothing is persisted, so a
 * fresh launch opens on the theme's style again. Recording deliberately has no
 * settings row of its own.
 *
 * The recording map does NOT read `preferences.defaultStyle`. That is the style
 * chosen for browsing a finished ride, and satellite has no street names, no
 * path casing and low contrast against a bright track in sunlight.
 */
let chosenStyle: MapStyleType | null = null;

/** Forget the ride's basemap choice. For tests; nothing in the app calls it. */
export function __resetRecordingMapStyle(): void {
  chosenStyle = null;
}

/** Room around the finished track in review mode, in pixels. */
const REVIEW_FIT_PADDING = {
  top: 40,
  right: 40,
  bottom: 60,
  left: 40,
} as const;

const NO_LINE = { points: [] as LngLat[], indices: [] as number[] };

interface RecordingMapProps {
  coordinates: [number, number][]; // [lat, lng] from recording streams
  /**
   * How many of `coordinates` to draw. A live recording passes the store's own
   * array, which grows in place, with the length its render saw.
   */
  coordinateCount?: number | undefined;
  currentLocation: { latitude: number; longitude: number } | null;
  /**
   * The current fix's accuracy in metres, drawn as a ring on the ground around
   * the position. The entry screen passes it while the fix is acquiring.
   */
  accuracy?: number | null | undefined;
  fitBounds?: boolean | undefined; // When true, fit camera to route bounds instead of following position
  trimStart?: number | undefined; // Index for trim start (used with fitBounds)
  trimEnd?: number | undefined; // Index for trim end (used with fitBounds)
  /** Saved route to follow, drawn under the live trace ([{lat, lng}] from the route engine) */
  routeOverlay?: LatLngShort[] | null | undefined;
  /** Opens the route picker; the layers button only renders when provided */
  onOpenRoutePicker?: (() => void) | undefined;
  style?: ViewStyle | undefined;
}

/**
 * The map's layers, bottom to top. The live track draws in the record role, the same as every
 * other recording surface.
 */
export function recordingMapLayers(isDark: boolean): MapLayerSpec[] {
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  return [
    {
      id: 'route-overlay-line',
      type: 'line',
      source: 'route-overlay',
      layout: roundLine,
      paint: {
        'line-color': OVERLAY_COLOR,
        'line-opacity': 0.75,
        'line-width': 5,
      },
    },
    {
      id: 'excluded-route-line',
      type: 'line',
      source: 'excluded-route',
      layout: roundLine,
      paint: { 'line-color': EXCLUDED_COLOR, 'line-width': 4 },
    },
    {
      id: 'recording-route-casing',
      type: 'line',
      source: 'recording-route',
      layout: roundLine,
      paint: { 'line-color': POSITION_DOT_HALO, 'line-width': 5 },
    },
    {
      id: 'recording-route-line',
      type: 'line',
      source: 'recording-route',
      layout: roundLine,
      paint: { 'line-color': recording[isDark ? 'dark' : 'light'], 'line-width': 4 },
    },
    {
      id: 'current-accuracy-fill',
      type: 'fill',
      source: 'current-accuracy',
      paint: { 'fill-color': ACCURACY_RING_COLOR, 'fill-opacity': 0.15 },
    },
    {
      id: 'current-accuracy-outline',
      type: 'line',
      source: 'current-accuracy',
      paint: {
        'line-color': ACCURACY_RING_COLOR,
        'line-opacity': 0.5,
        'line-width': 1,
      },
    },
    {
      id: 'current-position-halo',
      type: 'circle',
      source: 'current-position',
      paint: {
        'circle-radius': 10,
        'circle-color': POSITION_DOT_HALO,
        'circle-opacity': 0.9,
      },
    },
    {
      id: 'current-position-dot',
      type: 'circle',
      source: 'current-position',
      paint: { 'circle-radius': 7, 'circle-color': POSITION_DOT_COLOR },
    },
  ];
}

function RecordingMapInner({
  coordinates,
  coordinateCount,
  currentLocation,
  accuracy,
  fitBounds,
  trimStart,
  trimEnd,
  routeOverlay,
  onOpenRoutePicker,
  style,
}: RecordingMapProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  // Re-render on a cycle: the choice itself lives above the component so it
  // survives the athlete leaving the tab, and this is only what redraws.
  const [, bumpStyle] = useState(0);
  const themeStyle: MapStyleType = isDark ? 'dark' : 'light';
  const mapStyle: MapStyleType = useDrawnMapStyle(chosenStyle ?? themeStyle);
  const cycleStyle = useCallback(() => {
    chosenStyle = getNextStyle(mapStyle);
    bumpStyle((n) => n + 1);
  }, [mapStyle]);
  const surfaceRef = useRef<MapSurfaceRef>(null);
  // Released only when another screen covers this one, never while it is in
  // front, however long the recording runs.
  const screenFocused = useIsFocused();
  // Camera follows the current position until the user pans; the recenter
  // button restores following.
  const [isFollowing, setIsFollowing] = useState(true);

  // Only a gesture breaks the follow. A camera move we asked for does not.
  const handleRegionDidChange = useCallback((_state: unknown, isUserInteraction: boolean) => {
    if (isUserInteraction) setIsFollowing(false);
  }, []);

  // Recording streams arrive as [lat, lng]; the map wants [lng, lat]. Each
  // point is flipped once, on the fix that brought it, rather than the whole
  // track on every fix. The points array grows in place, so the memo hands out
  // a new wrapper per length for everything keyed on it.
  const count = coordinateCount ?? coordinates.length;
  const [growth] = useState(emptyGrowingLngLat);
  // Samples with no position are left out, so a point's place in the line is not
  // its place in the track, and the trim below goes through `indices`.
  const line = useMemo(() => {
    if (count < 2) return NO_LINE;
    const points = growLngLat(growth, coordinates, count);
    return { points, indices: growth.indices };
  }, [growth, coordinates, count]);

  // Build route GeoJSON - when trimming, split into active and excluded portions.
  // The pair is carried together rather than as a flag beside two loose ends,
  // so the slices below cannot be reached with either end missing.
  const trim = useMemo(() => {
    if (!fitBounds || trimStart == null || trimEnd == null) return null;
    if (trimStart <= 0 && trimEnd >= count - 1) return null;
    return { start: trimStart, end: trimEnd };
  }, [fitBounds, trimStart, trimEnd, count]);

  const activeRoute = useMemo(() => {
    const { points } = line;
    if (points.length < 2) return featureCollection([]);
    const active = trim ? pointsBetweenSourceIndices(line, trim.start, trim.end) : points;
    return featureCollection([lineFeature(active)]);
  }, [line, trim]);

  const excludedRoute = useMemo(() => {
    if (!trim || line.points.length < 2) return featureCollection([]);
    return featureCollection([
      trim.start > 0 ? lineFeature(pointsBetweenSourceIndices(line, 0, trim.start)) : null,
      trim.end < count - 1
        ? lineFeature(pointsBetweenSourceIndices(line, trim.end, count - 1))
        : null,
    ]);
  }, [line, trim, count]);

  const overlayRoute = useMemo(
    () => featureCollection([lineFeature(routeOverlay ? lngLatFromShort(routeOverlay) : [])]),
    [routeOverlay]
  );

  const position = useMemo(() => {
    if (!currentLocation) return featureCollection([]);
    const { latitude, longitude } = currentLocation;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return featureCollection([]);
    return featureCollection([pointFeature([longitude, latitude])]);
  }, [currentLocation]);

  // Kept as a source with an empty collection when there is no ring, so the
  // layer stays mounted and only its data changes.
  const accuracyRing = useMemo(() => {
    if (!currentLocation || accuracy == null) return featureCollection([]);
    const { latitude, longitude } = currentLocation;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return featureCollection([]);
    return featureCollection([circlePolygon([longitude, latitude], accuracy)]);
  }, [currentLocation, accuracy]);

  // Memoised so a fix at the same coordinates is the same array, which the
  // camera effect below depends on.
  const followTarget: LngLat | null = useMemo(
    () =>
      currentLocation &&
      Number.isFinite(currentLocation.latitude) &&
      Number.isFinite(currentLocation.longitude)
        ? [currentLocation.longitude, currentLocation.latitude]
        : null,
    [currentLocation]
  );

  const reviewBounds = useMemo(
    () => (fitBounds ? boundsOfLngLat(line.points) : null),
    [fitBounds, line]
  );

  // Live mode: keep the camera on the current position until the user pans.
  useEffect(() => {
    if (fitBounds || !isFollowing || !followTarget) return;
    surfaceRef.current?.setCamera({ center: followTarget, zoom: FOLLOW_ZOOM }, cameraMove.move);
  }, [fitBounds, isFollowing, followTarget]);

  // Review mode: frame the whole track once it is known.
  useEffect(() => {
    if (!fitBounds || !reviewBounds) return;
    surfaceRef.current?.fitBounds(reviewBounds, REVIEW_FIT_PADDING);
  }, [fitBounds, reviewBounds]);

  const sources = useMemo<Record<string, MapSourceSpec>>(
    () => ({
      'route-overlay': { kind: 'geojson', data: overlayRoute },
      'excluded-route': { kind: 'geojson', data: excludedRoute },
      // The live line only ever gains points at its end, so the surface ships
      // the fix rather than the ride. A trim moves the ends and falls back to
      // the whole line on its own.
      'recording-route': { kind: 'geojson', data: activeRoute, growing: true },
      'current-accuracy': { kind: 'geojson', data: accuracyRing },
      'current-position': { kind: 'geojson', data: position },
    }),
    [overlayRoute, excludedRoute, activeRoute, accuracyRing, position]
  );

  const layers = useMemo(() => recordingMapLayers(isDark), [isDark]);

  const initialCamera = useMemo(
    () =>
      reviewBounds
        ? { bounds: reviewBounds, padding: REVIEW_FIT_PADDING }
        : followTarget
          ? { center: followTarget, zoom: FOLLOW_ZOOM }
          : { center: [0, 0] as LngLat, zoom: 2 },
    // Only the first value matters: later moves go through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Later camera moves use the ref.
    []
  );

  return (
    <View style={[styles.container, style]}>
      <MapSurface
        ref={surfaceRef}
        mapStyle={mapStyle}
        initialCamera={initialCamera}
        sources={sources}
        layers={layers}
        released={!screenFocused}
        onRegionDidChange={fitBounds ? undefined : handleRegionDidChange}
      />

      {/* Map controls (live mode only) */}
      {!fitBounds && (
        <View style={styles.controls}>
          {onOpenRoutePicker ? (
            <Pressable
              testID="recording-map-route-overlay"
              style={pressable([
                styles.controlButton,
                routeOverlay ? styles.controlButtonActive : null,
              ])}
              onPress={onOpenRoutePicker}
              accessibilityRole="button"
              accessibilityLabel={t('recording.routeOverlay.title')}
              accessibilityState={{ selected: !!routeOverlay }}
              android_ripple={pressRipple}
            >
              <MaterialCommunityIcons
                name="map-marker-path"
                size={iconSize.md}
                color={routeOverlay ? colors.textOnDark : darkColors.textPrimary}
              />
            </Pressable>
          ) : null}
          <Pressable
            testID="recording-map-style"
            style={pressable(styles.controlButton)}
            onPress={cycleStyle}
            accessibilityRole="button"
            accessibilityLabel={t('maps.toggleStyle')}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons
              name="layers"
              size={iconSize.md}
              color={darkColors.textPrimary}
            />
          </Pressable>
          {!isFollowing && (
            <Pressable
              testID="recording-map-recenter"
              style={pressable(styles.controlButton)}
              onPress={() => setIsFollowing(true)}
              accessibilityRole="button"
              accessibilityLabel={t('maps.goToLocation')}
              android_ripple={pressRipple}
            >
              <MaterialCommunityIcons
                name="crosshairs-gps"
                size={iconSize.md}
                color={darkColors.textPrimary}
              />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

export const RecordingMap = React.memo(RecordingMapInner);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.background,
  },
  controls: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    gap: spacing.xs,
  },
  controlButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.borderRadiusFull,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: darkColors.surface,
    borderWidth: stroke.hairline,
    borderColor: darkColors.border,
  },
  controlButtonActive: {
    backgroundColor: brand.blue,
    borderColor: brand.blue,
  },
});
