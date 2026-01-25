import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import {
  MapView,
  Camera,
  GeoJSONSource,
  LineLayer,
  MarkerView,
  type LngLatBounds,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { convertLatLngTuples, getActivityColor, getMapLibreBounds } from '@/lib';
import { colors, layout } from '@/theme';
import { useMapPreferences } from '@/providers';
import { getMapStyle } from '@/components/maps';
import { useActivityStreams } from '@/hooks';
import type { Activity } from '@/types';

interface ActivityMapPreviewProps {
  activity: Activity;
  height?: number;
}

export function ActivityMapPreview({ activity, height = 160 }: ActivityMapPreviewProps) {
  const { getStyleForActivity } = useMapPreferences();
  const mapStyle = getStyleForActivity(activity.type);
  const activityColor = getActivityColor(activity.type);
  const [mapReady, setMapReady] = useState(false);

  const handleMapFullyRendered = useCallback(() => {
    setMapReady(true);
  }, []);

  // Check if activity has GPS data available
  const hasGpsData = activity.stream_types?.includes('latlng');

  // Only fetch streams if GPS data is available
  const { data: streams, isLoading } = useActivityStreams(hasGpsData ? activity.id : '');

  const coordinates = useMemo(() => {
    if (streams?.latlng && streams.latlng.length > 0) {
      return convertLatLngTuples(streams.latlng);
    }
    return [];
  }, [streams?.latlng]);

  // Filter valid coordinates for bounds and route display
  const validCoordinates = useMemo(() => {
    return coordinates.filter((c) => !isNaN(c.latitude) && !isNaN(c.longitude));
  }, [coordinates]);

  const bounds = useMemo(() => getMapLibreBounds(validCoordinates), [validCoordinates]);

  // iOS crash fix: Always return valid GeoJSON, never null
  // Using minimal valid LineString to avoid MapLibre "Invalid geometry" warnings
  const { routeGeoJSON, hasRouteData } = useMemo(() => {
    if (validCoordinates.length < 2) {
      return {
        routeGeoJSON: {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [0, 0],
                  [0, 0.0001],
                ],
              },
            },
          ],
        },
        hasRouteData: false,
      };
    }
    return {
      routeGeoJSON: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: validCoordinates.map((c) => [c.longitude, c.latitude]),
            },
          },
        ],
      },
      hasRouteData: true,
    };
  }, [validCoordinates]);

  const styleUrl = getMapStyle(mapStyle);
  const startPoint = validCoordinates[0];
  const endPoint = validCoordinates[validCoordinates.length - 1];

  // No GPS data available for this activity
  if (!hasGpsData) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  // Loading streams or no bounds
  if (isLoading || !bounds || validCoordinates.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '10' }]}>
        <ActivityIndicator size="small" color={activityColor} />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { height }]}
      testID={mapReady ? `activity-map-preview-ready-${activity.id}` : undefined}
    >
      <MapView
        style={styles.map}
        mapStyle={styleUrl}
        logo={false}
        attribution={false}
        compass={false}
        dragPan={false}
        touchAndDoubleTapZoom={false}
        touchRotate={false}
        touchPitch={false}
        onDidFinishRenderingMapFully={handleMapFullyRendered}
      >
        <Camera
          initialViewState={{
            bounds: [bounds.sw[0], bounds.sw[1], bounds.ne[0], bounds.ne[1]] as LngLatBounds,
            padding: { top: 30, right: 30, bottom: 30, left: 30 },
          }}
        />

        {/* Route line - iOS crash fix: always render GeoJSONSource */}
        <GeoJSONSource id="routeSource" data={routeGeoJSON}>
          <LineLayer
            id="routeLine"
            style={{
              lineColor: activityColor,
              lineOpacity: hasRouteData ? 1 : 0,
              lineWidth: 3,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </GeoJSONSource>

        {/* Start marker */}
        {startPoint && (
          <MarkerView coordinate={[startPoint.longitude, startPoint.latitude]}>
            <View style={styles.markerContainer}>
              <View style={[styles.marker, styles.startMarker]}>
                <MaterialCommunityIcons name="play" size={10} color={colors.textOnDark} />
              </View>
            </View>
          </MarkerView>
        )}

        {/* End marker */}
        {endPoint && (
          <MarkerView coordinate={[endPoint.longitude, endPoint.latitude]}>
            <View style={styles.markerContainer}>
              <View style={[styles.marker, styles.endMarker]}>
                <MaterialCommunityIcons name="flag-checkered" size={10} color={colors.textOnDark} />
              </View>
            </View>
          </MarkerView>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: layout.borderRadiusSm,
  },
  map: {
    flex: 1,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
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
});
