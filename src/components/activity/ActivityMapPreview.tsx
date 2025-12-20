import React, { useMemo, useRef, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import MapView, { Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getRegion, convertLatLngTuples } from '@/lib/polyline';
import { getActivityColor } from '@/lib';
import { colors } from '@/theme';
import { useActivityStreams } from '@/hooks';
import type { Activity } from '@/types';

interface ActivityMapPreviewProps {
  activity: Activity;
  height?: number;
}

export function ActivityMapPreview({ activity, height = 160 }: ActivityMapPreviewProps) {
  const mapRef = useRef<MapView>(null);
  const activityColor = getActivityColor(activity.type);

  // Check if activity has GPS data available
  const hasGpsData = activity.stream_types?.includes('latlng');

  // Only fetch streams if GPS data is available
  const { data: streams, isLoading } = useActivityStreams(
    hasGpsData ? activity.id : ''
  );

  const coordinates = useMemo(() => {
    if (streams?.latlng && streams.latlng.length > 0) {
      return convertLatLngTuples(streams.latlng);
    }
    return [];
  }, [streams?.latlng]);

  const region = useMemo(() => {
    if (coordinates.length > 0) {
      return getRegion(coordinates, 0.2);
    }
    return null;
  }, [coordinates]);

  // Fit map to route when ready
  const fitToRoute = useCallback(() => {
    if (mapRef.current && coordinates.length > 0) {
      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: { top: 30, right: 30, bottom: 30, left: 30 },
        animated: false,
      });
    }
  }, [coordinates]);

  // No GPS data available for this activity
  if (!hasGpsData) {
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

  // Loading streams
  if (isLoading || coordinates.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '10' }]}>
        <ActivityIndicator size="small" color={activityColor} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={region!}
        onMapReady={fitToRoute}
        onLayout={fitToRoute}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        showsIndoors={false}
        showsBuildings={false}
        showsTraffic={false}
        showsPointsOfInterest={false}
        liteMode={true}
      >
        <Polyline
          coordinates={coordinates}
          strokeColor={activityColor}
          strokeWidth={3}
        />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
