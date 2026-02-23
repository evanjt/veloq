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
const POSITION_DOT_COLOR = '#2563EB';
const POSITION_DOT_HALO = '#FFFFFF';

interface RecordingMapProps {
  coordinates: [number, number][]; // [lat, lng] from recording streams
  currentLocation: { latitude: number; longitude: number } | null;
  style?: ViewStyle;
}

function RecordingMapInner({ coordinates, currentLocation, style }: RecordingMapProps) {
  const { preferences } = useMapPreferences();
  const mapStyleValue = getMapStyle(preferences.defaultStyle);

  // Build route GeoJSON from recorded coordinates
  // Coordinates come as [lat, lng] but GeoJSON needs [lng, lat]
  const routeGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    const emptyCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };
    if (!coordinates || coordinates.length < 2) return emptyCollection;

    const validCoords = coordinates
      .map(([lat, lng]) => [lng, lat] as [number, number])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

    if (validCoords.length < 2) return emptyCollection;

    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords,
      },
    };
  }, [coordinates]);

  // Current position as GeoJSON point
  const positionGeoJSON = useMemo((): GeoJSON.Feature | null => {
    if (!currentLocation) return null;
    const { latitude, longitude } = currentLocation;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Point' as const,
        coordinates: [longitude, latitude],
      },
    };
  }, [currentLocation]);

  const cameraCenter = currentLocation
    ? ([currentLocation.longitude, currentLocation.latitude] as [number, number])
    : undefined;

  return (
    <View style={[styles.container, style]}>
      <MapView
        style={styles.map}
        mapStyle={mapStyleValue}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
      >
        <Camera
          defaultSettings={
            cameraCenter ? { centerCoordinate: cameraCenter, zoomLevel: 15 } : undefined
          }
          centerCoordinate={cameraCenter}
          zoomLevel={15}
          animationDuration={500}
        />

        {/* Route trace */}
        <ShapeSource id="recordingRoute" shape={routeGeoJSON}>
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
