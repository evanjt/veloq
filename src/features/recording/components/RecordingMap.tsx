import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import type { ViewStyle } from 'react-native';
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  CircleLayer,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import { getMapStyle } from '@/features/maps/components/mapStyles';
import { colors, darkColors, brand, spacing, layout } from '@/theme';

const BRAND_COLOR = brand.tealLight;
const EXCLUDED_COLOR = 'rgba(150, 150, 150, 0.5)';
const POSITION_DOT_COLOR = colors.secondary;
const POSITION_DOT_HALO = colors.surface;
const OVERLAY_COLOR = brand.blue;

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
  const mapStyleValue = getMapStyle(preferences.defaultStyle);
  // Camera follows the current position until the user pans; the recenter
  // button restores following.
  const [isFollowing, setIsFollowing] = useState(true);

  const handleRegionDidChange = useCallback((feature: GeoJSON.Feature) => {
    const properties = feature.properties as { isUserInteraction?: boolean } | undefined;
    if (properties?.isUserInteraction) {
      setIsFollowing(false);
    }
  }, []);

  // Convert [lat, lng] → [lng, lat] for GeoJSON
  const validCoords = useMemo(() => {
    if (!coordinates || coordinates.length < 2) return [];
    return coordinates
      .map(([lat, lng]) => [lng, lat] as [number, number])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  }, [coordinates]);

  // Build route GeoJSON — when trimming, split into active and excluded portions
  const hasTrim =
    fitBounds &&
    trimStart != null &&
    trimEnd != null &&
    (trimStart > 0 || trimEnd < coordinates.length - 1);

  const activeRouteGeoJSON = useMemo((): GeoJSON.Feature | GeoJSON.FeatureCollection => {
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (validCoords.length < 2) return empty;

    if (hasTrim) {
      const activeCoords = validCoords.slice(trimStart!, trimEnd! + 1);
      if (activeCoords.length < 2) return empty;
      return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: activeCoords },
      };
    }

    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: validCoords },
    };
  }, [validCoords, hasTrim, trimStart, trimEnd]);

  const excludedRouteGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (!hasTrim || validCoords.length < 2) return empty;

    const features: GeoJSON.Feature[] = [];
    // Before trim start
    if (trimStart! > 0) {
      const beforeCoords = validCoords.slice(0, trimStart! + 1);
      if (beforeCoords.length >= 2) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: beforeCoords },
        });
      }
    }
    // After trim end
    if (trimEnd! < validCoords.length - 1) {
      const afterCoords = validCoords.slice(trimEnd!);
      if (afterCoords.length >= 2) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: afterCoords },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }, [validCoords, hasTrim, trimStart, trimEnd]);

  // Saved-route overlay (drawn beneath the live trace)
  const overlayGeoJSON = useMemo((): GeoJSON.Feature | null => {
    if (!routeOverlay || routeOverlay.length < 2) return null;
    const coords = routeOverlay
      .map((p) => [p.lng, p.lat] as [number, number])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    if (coords.length < 2) return null;
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
  }, [routeOverlay]);

  // Current position as GeoJSON point
  const positionGeoJSON = useMemo((): GeoJSON.Feature | null => {
    if (!currentLocation) return null;
    const { latitude, longitude } = currentLocation;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
    };
  }, [currentLocation]);

  // Camera configuration
  const cameraCenter =
    currentLocation && isFollowing
      ? ([currentLocation.longitude, currentLocation.latitude] as [number, number])
      : undefined;

  const bounds = useMemo(() => {
    if (!fitBounds || validCoords.length < 2) return undefined;
    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const [lng, lat] of validCoords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return {
      ne: [maxLng, maxLat] as [number, number],
      sw: [minLng, minLat] as [number, number],
      paddingLeft: 40,
      paddingRight: 40,
      paddingTop: 40,
      paddingBottom: 60,
    };
  }, [fitBounds, validCoords]);

  return (
    <View style={[styles.container, style]}>
      <MapView
        style={styles.map}
        mapStyle={mapStyleValue}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onRegionDidChange={fitBounds ? undefined : handleRegionDidChange}
      >
        {fitBounds && bounds ? (
          <Camera defaultSettings={{ bounds }} bounds={bounds} animationDuration={0} />
        ) : (
          <Camera
            defaultSettings={
              cameraCenter ? { centerCoordinate: cameraCenter, zoomLevel: 15 } : undefined
            }
            centerCoordinate={cameraCenter}
            zoomLevel={isFollowing ? 15 : undefined}
            animationDuration={500}
          />
        )}

        {/* Saved-route overlay (beneath everything else) */}
        {overlayGeoJSON && (
          <ShapeSource id="routeOverlay" shape={overlayGeoJSON}>
            <LineLayer
              id="routeOverlayLine"
              style={{
                lineColor: OVERLAY_COLOR,
                lineOpacity: 0.75,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Excluded route portions (grey, behind active) */}
        {hasTrim && (
          <ShapeSource id="excludedRoute" shape={excludedRouteGeoJSON}>
            <LineLayer
              id="excludedRouteLine"
              style={{
                lineColor: EXCLUDED_COLOR,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Active route trace */}
        <ShapeSource id="recordingRoute" shape={activeRouteGeoJSON}>
          <LineLayer
            id="recordingRouteCasing"
            style={{
              lineColor: POSITION_DOT_HALO,
              lineOpacity: 1,
              lineWidth: 5,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            id="recordingRouteLine"
            style={{
              lineColor: BRAND_COLOR,
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>

        {/* Current position dot */}
        {positionGeoJSON && (
          <ShapeSource id="currentPosition" shape={positionGeoJSON}>
            <CircleLayer
              id="currentPositionHalo"
              style={{
                circleRadius: 10,
                circleColor: POSITION_DOT_HALO,
                circleOpacity: 0.9,
              }}
            />
            <CircleLayer
              id="currentPositionDot"
              style={{
                circleRadius: 7,
                circleColor: POSITION_DOT_COLOR,
                circleOpacity: 1,
              }}
            />
          </ShapeSource>
        )}
      </MapView>

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
  map: {
    flex: 1,
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
