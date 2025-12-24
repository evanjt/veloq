/**
 * Hero map view for route detail page.
 * Displays the route on a real map with start/end markers.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { MapView, Camera, ShapeSource, LineLayer, MarkerView } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor } from '@/lib';
import { colors } from '@/theme';
import { useMapPreferences } from '@/providers';
import { getMapStyle } from '@/components/maps';
import type { RouteGroup } from '@/types';

interface RouteMapViewProps {
  routeGroup: RouteGroup;
  height?: number;
}

export function RouteMapView({ routeGroup, height = 200 }: RouteMapViewProps) {
  const { getStyleForActivity } = useMapPreferences();
  const mapStyle = getStyleForActivity(routeGroup.type);
  const activityColor = getActivityColor(routeGroup.type);

  // Get points from signature
  const points = routeGroup.signature?.points || [];

  // Calculate bounds from points
  const bounds = useMemo(() => {
    if (points.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const point of points) {
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
      minLng = Math.min(minLng, point.lng);
      maxLng = Math.max(maxLng, point.lng);
    }

    return {
      ne: [maxLng, maxLat] as [number, number],
      sw: [minLng, minLat] as [number, number],
    };
  }, [points]);

  // Create GeoJSON for the route
  const routeGeoJSON = useMemo(() => {
    if (points.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: points.map(p => [p.lng, p.lat]),
      },
    };
  }, [points]);

  const styleUrl = getMapStyle(mapStyle);
  const startPoint = points[0];
  const endPoint = points[points.length - 1];

  if (!bounds || points.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons
          name="map-marker-off"
          size={32}
          color={activityColor}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <MapView
        style={styles.map}
        mapStyle={styleUrl}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Camera
          bounds={bounds}
          padding={{ paddingTop: 40, paddingRight: 40, paddingBottom: 40, paddingLeft: 40 }}
          animationDuration={0}
        />

        {/* Route line */}
        {routeGeoJSON && (
          <ShapeSource id="routeSource" shape={routeGeoJSON}>
            <LineLayer
              id="routeLine"
              style={{
                lineColor: activityColor,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Start marker */}
        {startPoint && (
          <MarkerView coordinate={[startPoint.lng, startPoint.lat]}>
            <View style={styles.markerContainer}>
              <View style={[styles.marker, styles.startMarker]}>
                <MaterialCommunityIcons name="play" size={12} color="#FFFFFF" />
              </View>
            </View>
          </MarkerView>
        )}

        {/* End marker */}
        {endPoint && (
          <MarkerView coordinate={[endPoint.lng, endPoint.lat]}>
            <View style={styles.markerContainer}>
              <View style={[styles.marker, styles.endMarker]}>
                <MaterialCommunityIcons name="flag-checkered" size={12} color="#FFFFFF" />
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
    borderRadius: 12,
  },
  map: {
    flex: 1,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
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
