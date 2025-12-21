import React, { useMemo, useState } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity, Pressable, Modal, StatusBar } from 'react-native';
import { MapView, Camera, ShapeSource, LineLayer, MarkerView } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { decodePolyline, getRegion, LatLng } from '@/lib/polyline';
import { getActivityColor } from '@/lib';
import { colors } from '@/theme';
import type { ActivityType } from '@/types';

// Map style options
export type MapStyleType = 'light' | 'dark' | 'satellite';

// OpenFreeMap styles - fully open source, no API key required
const MAP_STYLES: Record<MapStyleType, string> = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  satellite: 'https://tiles.openfreemap.org/styles/liberty', // Fallback to light for now
};

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
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = colorScheme === 'dark' ? 'dark' : 'light';
  const [mapStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? systemStyle);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleMapStyle = () => {
    setMapStyle(current => current === 'light' ? 'dark' : 'light');
  };

  const openFullscreen = () => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    }
  };

  const closeFullscreen = () => {
    setIsFullscreen(false);
  };

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

  const activityColor = getActivityColor(activityType);
  // Use first and last valid coordinates for start/end markers
  const startPoint = validCoordinates[0];
  const endPoint = validCoordinates[validCoordinates.length - 1];

  // Get the highlighted point from elevation chart selection
  const highlightPoint = useMemo(() => {
    if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < coordinates.length) {
      const coord = coordinates[highlightIndex];
      // Check for valid coordinates (NaN values indicate invalid/filtered points)
      if (coord && !isNaN(coord.latitude) && !isNaN(coord.longitude)) {
        return coord;
      }
    }
    return null;
  }, [highlightIndex, coordinates]);

  const styleUrl = MAP_STYLES[mapStyle];
  const isDarkMap = mapStyle === 'dark';

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
      {/* Inline map - kept mounted but hidden when fullscreen to avoid canceling tile requests */}
      <View style={[styles.inlineMapWrapper, isFullscreen && styles.hiddenMap]}>
        <MapView
          style={styles.map}
          mapStyle={styleUrl}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
        >
          <Camera
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

          {/* Highlight marker - shows current position from elevation chart */}
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

        {/* Tap overlay for fullscreen */}
        {enableFullscreen && !isFullscreen && (
          <Pressable
            style={styles.pressOverlay}
            onPress={openFullscreen}
          />
        )}

        {/* Map style toggle button */}
        {showStyleToggle && !isFullscreen && (
          <TouchableOpacity
            style={[styles.toggleButton, isDarkMap && styles.toggleButtonDark]}
            onPress={toggleMapStyle}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name={isDarkMap ? 'weather-sunny' : 'weather-night'}
              size={20}
              color={isDarkMap ? '#FFFFFF' : '#333333'}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Fullscreen modal */}
      <Modal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <View style={styles.fullscreenContainer}>
          <StatusBar barStyle={isDarkMap ? 'light-content' : 'dark-content'} />

          <MapView
            style={styles.fullscreenMap}
            mapStyle={styleUrl}
            logoEnabled={false}
            attributionEnabled={false}
            compassEnabled={true}
          >
            <Camera
              bounds={bounds}
              padding={{ paddingTop: 80 + insets.top, paddingRight: 40, paddingBottom: 40 + insets.bottom, paddingLeft: 40 }}
              animationDuration={300}
            />

            {/* Route line */}
            {routeGeoJSON && (
              <ShapeSource id="fullscreenRouteSource" shape={routeGeoJSON}>
                <LineLayer
                  id="fullscreenRouteLine"
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
          </MapView>

          {/* Close button */}
          <TouchableOpacity
            style={[styles.fullscreenButton, styles.closeButton, { top: insets.top + 12 }, isDarkMap && styles.fullscreenButtonDark]}
            onPress={closeFullscreen}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name="close"
              size={24}
              color={isDarkMap ? '#FFFFFF' : '#333333'}
            />
          </TouchableOpacity>

          {/* Style toggle */}
          <TouchableOpacity
            style={[styles.fullscreenButton, styles.styleButton, { top: insets.top + 12 }, isDarkMap && styles.fullscreenButtonDark]}
            onPress={toggleMapStyle}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name={isDarkMap ? 'weather-sunny' : 'weather-night'}
              size={24}
              color={isDarkMap ? '#FFFFFF' : '#333333'}
            />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

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
  toggleButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  toggleButtonDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
  pressOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  fullscreenMap: {
    flex: 1,
  },
  fullscreenButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  fullscreenButtonDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
  closeButton: {
    left: 16,
  },
  styleButton: {
    right: 16,
  },
});
