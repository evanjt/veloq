import React, { useMemo, useState, useRef, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, StatusBar, Animated } from 'react-native';
import { MapView, Camera, ShapeSource, LineLayer, MarkerView } from '@maplibre/maplibre-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { decodePolyline, LatLng } from '@/lib/polyline';
import { getActivityColor } from '@/lib';
import { colors } from '@/theme';
import { useMapPreferences } from '@/providers';
import { BaseMapView } from './BaseMapView';
import { CompassArrow } from '@/components/ui';
import { type MapStyleType, getMapStyle, isDarkStyle, getNextStyle, getStyleIcon } from './mapStyles';
import type { ActivityType } from '@/types';

interface ActivityMapViewProps {
  polyline?: string;
  coordinates?: LatLng[];
  activityType: ActivityType;
  height?: number;
  showStyleToggle?: boolean;
  initialStyle?: MapStyleType;
  /** Index into coordinates array to highlight (from elevation chart) */
  highlightIndex?: number | null;
  /** Enable fullscreen on tap */
  enableFullscreen?: boolean;
}

export function ActivityMapView({
  polyline: encodedPolyline,
  coordinates: providedCoordinates,
  activityType,
  height = 300,
  showStyleToggle = false,
  initialStyle,
  highlightIndex,
  enableFullscreen = false,
}: ActivityMapViewProps) {
  const { getStyleForActivity } = useMapPreferences();
  const preferredStyle = getStyleForActivity(activityType);
  const [mapStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? preferredStyle);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Update map style when preference changes (unless user manually toggled)
  const [userOverride, setUserOverride] = useState(false);
  if (!userOverride && !initialStyle && mapStyle !== preferredStyle) {
    setMapStyle(preferredStyle);
  }

  const toggleMapStyle = () => {
    setUserOverride(true);
    setMapStyle(current => getNextStyle(current));
  };

  const openFullscreen = useCallback(() => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    }
  }, [enableFullscreen]);

  const closeFullscreen = () => {
    setIsFullscreen(false);
  };

  // Tap gesture - only triggers on actual taps, not after panning
  const tapGesture = Gesture.Tap()
    .onEnd(() => {
      if (enableFullscreen) {
        openFullscreen();
      }
    })
    .runOnJS(true);

  // Compass bearing state
  const bearingAnim = useRef(new Animated.Value(0)).current;

  // Handle map region change to update compass
  const handleRegionIsChanging = useCallback((feature: GeoJSON.Feature) => {
    const properties = feature.properties as { heading?: number } | undefined;
    if (properties?.heading !== undefined) {
      bearingAnim.setValue(-properties.heading);
    }
  }, [bearingAnim]);

  // Camera ref for programmatic control
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);

  // Reset bearing to north
  const resetOrientation = useCallback(() => {
    cameraRef.current?.setCamera({
      heading: 0,
      animationDuration: 300,
    });
    Animated.timing(bearingAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [bearingAnim]);

  const coordinates = useMemo(() => {
    if (providedCoordinates && providedCoordinates.length > 0) {
      return providedCoordinates;
    }
    if (encodedPolyline) {
      return decodePolyline(encodedPolyline);
    }
    return [];
  }, [encodedPolyline, providedCoordinates]);

  // Filter valid coordinates for bounds and route display
  const validCoordinates = useMemo(() => {
    return coordinates.filter(c => !isNaN(c.latitude) && !isNaN(c.longitude));
  }, [coordinates]);

  const bounds = useMemo(() => {
    if (validCoordinates.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const coord of validCoordinates) {
      minLat = Math.min(minLat, coord.latitude);
      maxLat = Math.max(maxLat, coord.latitude);
      minLng = Math.min(minLng, coord.longitude);
      maxLng = Math.max(maxLng, coord.longitude);
    }

    return {
      ne: [maxLng, maxLat] as [number, number],
      sw: [minLng, minLat] as [number, number],
    };
  }, [validCoordinates]);

  const routeGeoJSON = useMemo(() => {
    if (validCoordinates.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoordinates.map(c => [c.longitude, c.latitude]),
      },
    };
  }, [validCoordinates]);

  // Route coordinates for BaseMapView/Map3DWebView [lng, lat] format
  const routeCoords = useMemo(() => {
    return validCoordinates.map(c => [c.longitude, c.latitude] as [number, number]);
  }, [validCoordinates]);

  const activityColor = getActivityColor(activityType);
  const startPoint = validCoordinates[0];
  const endPoint = validCoordinates[validCoordinates.length - 1];

  // Get the highlighted point from elevation chart selection
  const highlightPoint = useMemo(() => {
    if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < coordinates.length) {
      const coord = coordinates[highlightIndex];
      if (coord && !isNaN(coord.latitude) && !isNaN(coord.longitude)) {
        return coord;
      }
    }
    return null;
  }, [highlightIndex, coordinates]);

  const mapStyleValue = getMapStyle(mapStyle);
  const isDark = isDarkStyle(mapStyle);

  if (!bounds || validCoordinates.length === 0) {
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
      {/* Inline preview map - tap anywhere to open fullscreen */}
      <GestureDetector gesture={tapGesture}>
        <View style={[styles.inlineMapWrapper, isFullscreen && styles.hiddenMap]}>
          <MapView
          style={styles.map}
          mapStyle={mapStyleValue}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scrollEnabled={true}
          zoomEnabled={true}
          rotateEnabled={true}
          pitchEnabled={false}
          onRegionIsChanging={handleRegionIsChanging}
        >
          <Camera
            ref={cameraRef}
            bounds={bounds}
            padding={{ paddingTop: 50, paddingRight: 50, paddingBottom: 50, paddingLeft: 50 }}
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
            <MarkerView coordinate={[startPoint.longitude, startPoint.latitude]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.startMarker]}>
                  <MaterialCommunityIcons name="play" size={14} color="#FFFFFF" />
                </View>
              </View>
            </MarkerView>
          )}

          {/* End marker */}
          {endPoint && (
            <MarkerView coordinate={[endPoint.longitude, endPoint.latitude]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.endMarker]}>
                  <MaterialCommunityIcons name="flag-checkered" size={14} color="#FFFFFF" />
                </View>
              </View>
            </MarkerView>
          )}

          {/* Highlight marker from elevation chart */}
          {highlightPoint && (
            <MarkerView coordinate={[highlightPoint.longitude, highlightPoint.latitude]}>
              <View style={styles.markerContainer}>
                <View style={styles.highlightMarker}>
                  <View style={styles.highlightMarkerInner} />
                </View>
              </View>
            </MarkerView>
          )}
        </MapView>

        {/* Control buttons - right side, positioned lower */}
        {showStyleToggle && (
          <View style={styles.controlStack}>
            {/* Map style toggle */}
            <TouchableOpacity
              style={[styles.controlButton, isDark && styles.controlButtonDark]}
              onPress={toggleMapStyle}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons
                name={getStyleIcon(mapStyle)}
                size={22}
                color={isDark ? '#FFFFFF' : '#333333'}
              />
            </TouchableOpacity>

            {/* Compass / North arrow */}
            <TouchableOpacity
              style={[styles.controlButton, isDark && styles.controlButtonDark]}
              onPress={resetOrientation}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <CompassArrow
                size={20}
                rotation={bearingAnim}
                northColor="#E53935"
                southColor={isDark ? '#FFFFFF' : '#333333'}
              />
            </TouchableOpacity>
          </View>
        )}
        </View>
      </GestureDetector>

      {/* Fullscreen modal using BaseMapView */}
      <Modal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <BaseMapView
          routeCoordinates={routeCoords}
          routeColor={activityColor}
          bounds={bounds}
          initialStyle={mapStyle}
          onClose={closeFullscreen}
        >
          {/* Start marker */}
          {startPoint && (
            <MarkerView coordinate={[startPoint.longitude, startPoint.latitude]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.startMarker]}>
                  <MaterialCommunityIcons name="play" size={14} color="#FFFFFF" />
                </View>
              </View>
            </MarkerView>
          )}

          {/* End marker */}
          {endPoint && (
            <MarkerView coordinate={[endPoint.longitude, endPoint.latitude]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.endMarker]}>
                  <MaterialCommunityIcons name="flag-checkered" size={14} color="#FFFFFF" />
                </View>
              </View>
            </MarkerView>
          )}
        </BaseMapView>
      </Modal>
    </View>
  );
}

// Re-export MapStyleType for backwards compatibility
export type { MapStyleType };

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  inlineMapWrapper: {
    flex: 1,
  },
  hiddenMap: {
    opacity: 0,
    pointerEvents: 'none',
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
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  startMarker: {
    backgroundColor: colors.success,
  },
  endMarker: {
    backgroundColor: colors.error,
  },
  highlightMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  highlightMarkerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  controlStack: {
    position: 'absolute',
    top: 60, // Lower position - below any header overlap
    right: 12,
    gap: 8,
  },
  controlButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  controlButtonDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
});
