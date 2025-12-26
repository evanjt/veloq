/**
 * Hero map view for section detail page.
 * Displays the section polyline (medoid trace) prominently.
 */

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, StatusBar } from 'react-native';
import MapLibreGL, { Camera, ShapeSource, LineLayer, MarkerView } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor } from '@/lib';
import { colors, spacing, layout } from '@/theme';
import { useMapPreferences } from '@/providers';
import { getMapStyle, BaseMapView, isDarkStyle } from '@/components/maps';
import type { FrequentSection, RoutePoint } from '@/types';

const { MapView } = MapLibreGL;

interface SectionMapViewProps {
  section: FrequentSection;
  height?: number;
  /** Enable map interaction (zoom, pan). Default false for preview, true for detail. */
  interactive?: boolean;
  /** Enable tap to fullscreen */
  enableFullscreen?: boolean;
}

export function SectionMapView({
  section,
  height = 200,
  interactive = false,
  enableFullscreen = false,
}: SectionMapViewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { getStyleForActivity } = useMapPreferences();
  const mapStyle = getStyleForActivity(section.sportType as any);
  const activityColor = getActivityColor(section.sportType as any);
  const mapRef = useRef(null);

  const displayPoints = section.polyline || [];

  // Calculate bounds from the section polyline
  const bounds = useMemo(() => {
    if (displayPoints.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const point of displayPoints) {
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
      minLng = Math.min(minLng, point.lng);
      maxLng = Math.max(maxLng, point.lng);
    }

    // Add small padding
    const latPad = (maxLat - minLat) * 0.15;
    const lngPad = (maxLng - minLng) * 0.15;

    return {
      ne: [maxLng + lngPad, maxLat + latPad] as [number, number],
      sw: [minLng - lngPad, minLat - latPad] as [number, number],
    };
  }, [displayPoints]);

  // Create GeoJSON for the section polyline
  const sectionGeoJSON = useMemo(() => {
    if (displayPoints.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: displayPoints.map(p => [p.lng, p.lat]),
      },
    };
  }, [displayPoints]);

  const styleUrl = getMapStyle(mapStyle);

  const startPoint = displayPoints[0];
  const endPoint = displayPoints[displayPoints.length - 1];

  if (!bounds || displayPoints.length === 0) {
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

  const mapContent = (
    <MapView
      ref={mapRef}
      style={styles.map}
      mapStyle={styleUrl}
      logoEnabled={false}
      attributionEnabled={false}
      compassEnabled={interactive}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={false}
    >
      <Camera
        bounds={bounds}
        padding={{ paddingTop: 40, paddingRight: 40, paddingBottom: 40, paddingLeft: 40 }}
        animationDuration={0}
      />

      {/* Section polyline */}
      {sectionGeoJSON && (
        <ShapeSource id="sectionSource" shape={sectionGeoJSON}>
          <LineLayer
            id="sectionLine"
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
  );

  const handleMapPress = useCallback(() => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    }
  }, [enableFullscreen]);

  const closeFullscreen = useCallback(() => {
    setIsFullscreen(false);
  }, []);

  // Section coordinates for BaseMapView [lng, lat] format
  const sectionCoords = useMemo(() => {
    return displayPoints.map(p => [p.lng, p.lat] as [number, number]);
  }, [displayPoints]);

  const isDark = isDarkStyle(mapStyle);

  const showExpandIcon = enableFullscreen && !interactive;

  return (
    <>
      <TouchableOpacity
        style={[styles.container, { height }]}
        onPress={handleMapPress}
        activeOpacity={enableFullscreen ? 0.9 : 1}
        disabled={!enableFullscreen}
      >
        {mapContent}
        {showExpandIcon && (
          <View style={styles.expandOverlay}>
            <MaterialCommunityIcons name="fullscreen" size={20} color="#FFFFFF" />
          </View>
        )}
      </TouchableOpacity>

      {/* Fullscreen modal using BaseMapView */}
      <Modal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <BaseMapView
          routeCoordinates={sectionCoords}
          routeColor={activityColor}
          bounds={bounds || undefined}
          initialStyle={mapStyle}
          onClose={closeFullscreen}
        >
          {/* Start marker */}
          {startPoint && (
            <MarkerView coordinate={[startPoint.lng, startPoint.lat]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.startMarker]}>
                  <MaterialCommunityIcons name="play" size={14} color="#FFFFFF" />
                </View>
              </View>
            </MarkerView>
          )}

          {/* End marker */}
          {endPoint && (
            <MarkerView coordinate={[endPoint.lng, endPoint.lat]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.endMarker]}>
                  <MaterialCommunityIcons name="flag-checkered" size={14} color="#FFFFFF" />
                </View>
              </View>
            </MarkerView>
          )}
        </BaseMapView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: layout.borderRadius,
  },
  map: {
    flex: 1,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadius,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 24,
    height: 24,
    borderRadius: layout.borderRadius,
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
  expandOverlay: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 6,
    padding: spacing.xs,
  },
});
