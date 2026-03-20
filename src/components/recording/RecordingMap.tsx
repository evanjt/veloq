import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  CircleLayer,
} from '@maplibre/maplibre-react-native';
import { useMapPreferences } from '@/providers';
import { getMapStyle } from '@/components/maps/mapStyles';
import { darkColors } from '@/theme';

const BRAND_COLOR = '#FC4C02';
const EXCLUDED_COLOR = 'rgba(150, 150, 150, 0.5)';
const GUIDANCE_COLOR = 'rgba(100, 140, 200, 0.5)';
const POSITION_DOT_COLOR = '#2563EB';
const POSITION_DOT_HALO = '#FFFFFF';

interface RecordingMapProps {
  coordinates: [number, number][]; // [lat, lng] from recording streams
  currentLocation: { latitude: number; longitude: number } | null;
  fitBounds?: boolean; // When true, fit camera to route bounds instead of following position
  trimStart?: number; // Index for trim start (used with fitBounds)
  trimEnd?: number; // Index for trim end (used with fitBounds)
  guidancePolyline?: [number, number][]; // Optional [lat, lng] reference line for route guidance
  style?: ViewStyle;
}

function RecordingMapInner({
  coordinates,
  currentLocation,
  fitBounds,
  trimStart,
  trimEnd,
  guidancePolyline,
  style,
}: RecordingMapProps) {
  const { preferences } = useMapPreferences();
  const mapStyleValue = getMapStyle(preferences.defaultStyle);

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

  // Guidance polyline GeoJSON (optional reference route)
  const guidanceGeoJSON = useMemo((): GeoJSON.Feature | null => {
    if (!guidancePolyline || guidancePolyline.length < 2) return null;
    const coords = guidancePolyline
      .map(([lat, lng]) => [lng, lat] as [number, number])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    if (coords.length < 2) return null;
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
  }, [guidancePolyline]);

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
  const cameraCenter = currentLocation
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
      >
        {fitBounds && bounds ? (
          <Camera defaultSettings={{ bounds }} bounds={bounds} animationDuration={0} />
        ) : (
          <Camera
            defaultSettings={
              cameraCenter ? { centerCoordinate: cameraCenter, zoomLevel: 15 } : undefined
            }
            centerCoordinate={cameraCenter}
            zoomLevel={15}
            animationDuration={500}
          />
        )}

        {/* Guidance reference route (dashed, behind everything) */}
        {guidanceGeoJSON && (
          <ShapeSource id="guidanceRoute" shape={guidanceGeoJSON}>
            <LineLayer
              id="guidanceRouteLine"
              style={{
                lineColor: GUIDANCE_COLOR,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
                lineDasharray: [2, 3],
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
});
