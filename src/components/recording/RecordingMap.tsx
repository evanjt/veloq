import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Map as MLMap, Camera, GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { toLngLatBounds, toViewPadding } from '@/lib/maps/bounds';
import { useMapPreferences } from '@/providers';
import { getMapStyle } from '@/components/maps/mapStyles';
import { darkColors, brand } from '@/theme';

const BRAND_COLOR = brand.orange;
const EXCLUDED_COLOR = 'rgba(150, 150, 150, 0.5)';
const POSITION_DOT_COLOR = '#2563EB';
const POSITION_DOT_HALO = '#FFFFFF';

interface RecordingMapProps {
  coordinates: [number, number][]; // [lat, lng] from recording streams
  currentLocation: { latitude: number; longitude: number } | null;
  fitBounds?: boolean; // When true, fit camera to route bounds instead of following position
  trimStart?: number; // Index for trim start (used with fitBounds)
  trimEnd?: number; // Index for trim end (used with fitBounds)
  style?: ViewStyle;
}

function RecordingMapInner({
  coordinates,
  currentLocation,
  fitBounds,
  trimStart,
  trimEnd,
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

  const v11Bounds = bounds
    ? {
        bounds: toLngLatBounds({ ne: bounds.ne, sw: bounds.sw }),
        padding: toViewPadding(bounds),
      }
    : null;

  return (
    <View style={[styles.container, style]}>
      <MLMap style={styles.map} mapStyle={mapStyleValue} logo={false} attribution={false} compass={false}>
        {fitBounds && v11Bounds ? (
          <Camera initialViewState={v11Bounds} bounds={v11Bounds.bounds} duration={0} />
        ) : (
          <Camera
            initialViewState={cameraCenter ? { center: cameraCenter, zoom: 15 } : undefined}
            center={cameraCenter}
            zoom={15}
            duration={500}
          />
        )}

        {/* Excluded route portions (grey, behind active) */}
        {hasTrim && (
          <GeoJSONSource id="excludedRoute" data={excludedRouteGeoJSON}>
            <Layer
              type="line"
              id="excludedRouteLine"
              style={{
                lineColor: EXCLUDED_COLOR,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </GeoJSONSource>
        )}

        {/* Active route trace */}
        <GeoJSONSource id="recordingRoute" data={activeRouteGeoJSON}>
          <Layer
            type="line"
            id="recordingRouteCasing"
            style={{
              lineColor: POSITION_DOT_HALO,
              lineOpacity: 1,
              lineWidth: 5,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <Layer
            type="line"
            id="recordingRouteLine"
            style={{
              lineColor: BRAND_COLOR,
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </GeoJSONSource>

        {/* Current position dot */}
        {positionGeoJSON && (
          <GeoJSONSource id="currentPosition" data={positionGeoJSON}>
            <Layer
              type="circle"
              id="currentPositionHalo"
              style={{
                circleRadius: 10,
                circleColor: POSITION_DOT_HALO,
                circleOpacity: 0.9,
              }}
            />
            <Layer
              type="circle"
              id="currentPositionDot"
              style={{
                circleRadius: 7,
                circleColor: POSITION_DOT_COLOR,
                circleOpacity: 1,
              }}
            />
          </GeoJSONSource>
        )}
      </MLMap>
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
