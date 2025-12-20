import React, { useMemo, useRef, useCallback } from 'react';
import { View, StyleSheet, useColorScheme, Platform } from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { decodePolyline, getRegion, LatLng } from '@/lib/polyline';
import { getActivityColor } from '@/lib';
import { colors } from '@/theme';
import type { ActivityType } from '@/types';

interface ActivityMapViewProps {
  polyline?: string;
  coordinates?: LatLng[];
  activityType: ActivityType;
  height?: number;
}

export function ActivityMapView({
  polyline: encodedPolyline,
  coordinates: providedCoordinates,
  activityType,
  height = 300,
}: ActivityMapViewProps) {
  const mapRef = useRef<MapView>(null);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const coordinates = useMemo(() => {
    if (providedCoordinates && providedCoordinates.length > 0) {
      return providedCoordinates;
    }
    if (encodedPolyline) {
      return decodePolyline(encodedPolyline);
    }
    return [];
  }, [encodedPolyline, providedCoordinates]);

  const region = useMemo(() => {
    if (coordinates.length > 0) {
      return getRegion(coordinates, 0.15);
    }
    return null;
  }, [coordinates]);

  const activityColor = getActivityColor(activityType);

  const startPoint = coordinates[0];
  const endPoint = coordinates[coordinates.length - 1];

  // Fit map to show all coordinates with padding
  const fitToRoute = useCallback(() => {
    if (mapRef.current && coordinates.length > 0) {
      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: {
          top: 50,
          right: 50,
          bottom: 50,
          left: 50,
        },
        animated: false,
      });
    }
  }, [coordinates]);

  if (!region || coordinates.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <MaterialCommunityIcons
          name="map-marker-off"
          size={48}
          color={colors.textSecondary}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        onMapReady={fitToRoute}
        onLayout={fitToRoute}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        showsIndoors={false}
        showsBuildings={false}
        showsTraffic={false}
        showsPointsOfInterest={false}
        mapType="standard"
      >
        {/* Route polyline */}
        <Polyline
          coordinates={coordinates}
          strokeColor={activityColor}
          strokeWidth={4}
        />

        {/* Start marker */}
        {startPoint && (
          <Marker
            coordinate={startPoint}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.marker, styles.startMarker]}>
              <MaterialCommunityIcons name="play" size={12} color="#FFFFFF" />
            </View>
          </Marker>
        )}

        {/* End marker */}
        {endPoint && (
          <Marker
            coordinate={endPoint}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.marker, styles.endMarker]}>
              <MaterialCommunityIcons name="flag-checkered" size={12} color="#FFFFFF" />
            </View>
          </Marker>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  startMarker: {
    backgroundColor: colors.success,
  },
  endMarker: {
    backgroundColor: colors.error,
  },
});
