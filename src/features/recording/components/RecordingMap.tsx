import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import type { ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import { MapSurface, type MapSurfaceRef } from '@/features/maps/components/MapSurface';
import {
  boundsOfLngLat,
  featureCollection,
  lineFeature,
  lngLatFromLatLngTuples,
  lngLatFromShort,
  pointFeature,
  type LngLat,
} from '@/features/maps/lib/coordinates';
import type { MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { colors, darkColors, brand, spacing, layout } from '@/theme';

const BRAND_COLOR = brand.tealLight;
const EXCLUDED_COLOR = 'rgba(150, 150, 150, 0.5)';
const POSITION_DOT_COLOR = colors.secondary;
const POSITION_DOT_HALO = colors.surface;
const OVERLAY_COLOR = brand.blue;

/** Zoom held while the camera follows the current position. */
const FOLLOW_ZOOM = 15;

/** Room around the finished track in review mode, in pixels. */
const REVIEW_FIT_PADDING = { top: 40, right: 40, bottom: 60, left: 40 } as const;

const SURFACE_STYLE_OPTIONS = { bundledLightStyle: true, cacheVectorTiles: true } as const;

interface RecordingMapProps {
  coordinates: [number, number][]; // [lat, lng] from recording streams
  currentLocation: { latitude: number; longitude: number } | null;
  fitBounds?: boolean; // When true, fit camera to route bounds instead of following position
  trimStart?: number; // Index for trim start (used with fitBounds)
  trimEnd?: number; // Index for trim end (used with fitBounds)
  /** Saved route to follow, drawn under the live trace ([{lat, lng}] from the route engine) */
  routeOverlay?: Array<{ lat: number; lng: number }> | null;
  /** Opens the route picker; the layers button only renders when provided */
  onOpenRoutePicker?: () => void;
  style?: ViewStyle;
}

function RecordingMapInner({
  coordinates,
  currentLocation,
  fitBounds,
  trimStart,
  trimEnd,
  routeOverlay,
  onOpenRoutePicker,
  style,
}: RecordingMapProps) {
  const { preferences } = useMapPreferences();
  const surfaceRef = useRef<MapSurfaceRef>(null);
  // Camera follows the current position until the user pans; the recenter
  // button restores following.
  const [isFollowing, setIsFollowing] = useState(true);

  // Only a gesture breaks the follow. A camera move we asked for does not.
  const handleRegionDidChange = useCallback((_state: unknown, isUserInteraction: boolean) => {
    if (isUserInteraction) setIsFollowing(false);
  }, []);

  // Recording streams arrive as [lat, lng]; the map wants [lng, lat].
  const validCoords = useMemo(
    () => (coordinates && coordinates.length >= 2 ? lngLatFromLatLngTuples(coordinates) : []),
    [coordinates]
  );

  // Build route GeoJSON - when trimming, split into active and excluded portions
  const hasTrim =
    fitBounds &&
    trimStart != null &&
    trimEnd != null &&
    (trimStart > 0 || trimEnd < coordinates.length - 1);

  const activeRoute = useMemo(() => {
    if (validCoords.length < 2) return featureCollection([]);
    const active = hasTrim ? validCoords.slice(trimStart!, trimEnd! + 1) : validCoords;
    return featureCollection([lineFeature(active)]);
  }, [validCoords, hasTrim, trimStart, trimEnd]);

  const excludedRoute = useMemo(() => {
    if (!hasTrim || validCoords.length < 2) return featureCollection([]);
    return featureCollection([
      trimStart! > 0 ? lineFeature(validCoords.slice(0, trimStart! + 1)) : null,
      trimEnd! < validCoords.length - 1 ? lineFeature(validCoords.slice(trimEnd!)) : null,
    ]);
  }, [validCoords, hasTrim, trimStart, trimEnd]);

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

  const followTarget: LngLat | null =
    currentLocation &&
    Number.isFinite(currentLocation.latitude) &&
    Number.isFinite(currentLocation.longitude)
      ? [currentLocation.longitude, currentLocation.latitude]
      : null;

  const reviewBounds = useMemo(
    () => (fitBounds ? boundsOfLngLat(validCoords) : null),
    [fitBounds, validCoords]
  );

  // Live mode: keep the camera on the current position until the user pans.
  useEffect(() => {
    if (fitBounds || !isFollowing || !followTarget) return;
    surfaceRef.current?.setCamera({ center: followTarget, zoom: FOLLOW_ZOOM }, 500);
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
      'recording-route': { kind: 'geojson', data: activeRoute },
      'current-position': { kind: 'geojson', data: position },
    }),
    [overlayRoute, excludedRoute, activeRoute, position]
  );

  const layers = useMemo<MapLayerSpec[]>(() => {
    const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
    return [
      {
        id: 'route-overlay-line',
        type: 'line',
        source: 'route-overlay',
        layout: roundLine,
        paint: { 'line-color': OVERLAY_COLOR, 'line-opacity': 0.75, 'line-width': 5 },
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
        paint: { 'line-color': BRAND_COLOR, 'line-width': 4 },
      },
      {
        id: 'current-position-halo',
        type: 'circle',
        source: 'current-position',
        paint: { 'circle-radius': 10, 'circle-color': POSITION_DOT_HALO, 'circle-opacity': 0.9 },
      },
      {
        id: 'current-position-dot',
        type: 'circle',
        source: 'current-position',
        paint: { 'circle-radius': 7, 'circle-color': POSITION_DOT_COLOR },
      },
    ];
  }, []);

  const initialCamera = useMemo(
    () =>
      reviewBounds
        ? { bounds: reviewBounds, padding: REVIEW_FIT_PADDING }
        : followTarget
          ? { center: followTarget, zoom: FOLLOW_ZOOM }
          : { center: [0, 0] as LngLat, zoom: 2 },
    // Only the first value matters: later moves go through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <View style={[styles.container, style]}>
      <MapSurface
        ref={surfaceRef}
        mapStyle={preferences.defaultStyle}
        styleOptions={SURFACE_STYLE_OPTIONS}
        initialCamera={initialCamera}
        sources={sources}
        layers={layers}
        onRegionDidChange={fitBounds ? undefined : handleRegionDidChange}
      />

      {/* Map controls (live mode only) */}
      {!fitBounds && (
        <View style={styles.controls}>
          {onOpenRoutePicker && (
            <TouchableOpacity
              testID="recording-map-route-overlay"
              style={[styles.controlButton, routeOverlay ? styles.controlButtonActive : null]}
              onPress={onOpenRoutePicker}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons
                name="map-marker-path"
                size={20}
                color={routeOverlay ? colors.textOnDark : darkColors.textPrimary}
              />
            </TouchableOpacity>
          )}
          {!isFollowing && (
            <TouchableOpacity
              testID="recording-map-recenter"
              style={styles.controlButton}
              onPress={() => setIsFollowing(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons
                name="crosshairs-gps"
                size={20}
                color={darkColors.textPrimary}
              />
            </TouchableOpacity>
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: darkColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: darkColors.border,
    minWidth: layout.minTapTarget - 4,
    minHeight: layout.minTapTarget - 4,
  },
  controlButtonActive: {
    backgroundColor: brand.blue,
    borderColor: brand.blue,
  },
});
