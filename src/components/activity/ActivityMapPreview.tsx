import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Platform } from 'react-native';

// Exported for compatibility but no longer used for scroll tracking
export function notifyMapScroll(_visibleIndex: number) {
  // No-op - using simple staggered loading instead
}
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  MarkerView,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { convertLatLngTuples, getActivityColor, getMapLibreBounds } from '@/lib';
import { colors } from '@/theme';
import { useMapPreferences } from '@/providers';
import { getMapStyle } from '@/components/maps';
import { useActivityStreams } from '@/hooks';
import type { Activity } from '@/types';

interface ActivityMapPreviewProps {
  activity: Activity;
  height?: number;
  index?: number;
}

export function ActivityMapPreview({ activity, height = 160, index = 0 }: ActivityMapPreviewProps) {
  const { getStyleForActivity } = useMapPreferences();
  const mapStyle = getStyleForActivity(activity.type);
  const activityColor = getActivityColor(activity.type);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);

  // Map retry mechanism for transient failures
  const [mapKey, setMapKey] = useState(0);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 500;

  // Stagger showing maps - always render MapView but delay removing loading overlay
  // This prevents overwhelming tile requests while allowing proper MapView initialization
  // All maps get a minimum delay to give native MapView time to render and call onDidFinishRenderingMapFully
  const [showMapContent, setShowMapContent] = useState(false);

  useEffect(() => {
    // First map gets 100ms grace period, subsequent maps get index * 150ms stagger
    const delay = index === 0 ? 100 : index * 150;
    const timeout = setTimeout(() => setShowMapContent(true), delay);
    return () => clearTimeout(timeout);
  }, [index]);

  const handleMapFullyRendered = useCallback(() => {
    setMapReady(true);
    setMapError(false);
  }, []);

  // Handle map load failure - retry on both platforms, then show error state
  const handleMapLoadError = useCallback(() => {
    if (retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current += 1;
      console.log(
        `[ActivityMapPreview] Load failed for ${activity.id}, retrying (${retryCountRef.current}/${MAX_RETRIES})...`
      );
      setTimeout(() => {
        setMapKey((k) => k + 1);
      }, RETRY_DELAY_MS * retryCountRef.current);
    } else {
      // Retries exhausted - show error state instead of infinite spinner
      console.warn(
        `[ActivityMapPreview] Map load failed for ${activity.id} after ${MAX_RETRIES} retries`
      );
      setMapError(true);
      setMapReady(true); // Remove loading overlay
    }
  }, [activity.id]);

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

  // Calculate center and zoom from bounds instead of using bounds directly
  // This fixes the FlatList issue where Camera bounds fail when map is off-screen
  // (native layer reports 64x64px size, causing zoom calculations to fail)
  const { center, zoomLevel } = useMemo(() => {
    if (!bounds) return { center: null, zoomLevel: 10 };

    // Calculate center
    const centerLng = (bounds.ne[0] + bounds.sw[0]) / 2;
    const centerLat = (bounds.ne[1] + bounds.sw[1]) / 2;

    // Validate center coordinates
    if (!isFinite(centerLng) || !isFinite(centerLat)) {
      return { center: null, zoomLevel: 10 };
    }

    // Calculate zoom level based on bounds span
    // Using Mercator projection: zoom ≈ log2(360 / lonSpan) or log2(180 / latSpan)
    const latSpan = Math.abs(bounds.ne[1] - bounds.sw[1]);
    const lngSpan = Math.abs(bounds.ne[0] - bounds.sw[0]);

    // Handle single-point or very small activities
    if (latSpan < 0.0001 && lngSpan < 0.0001) {
      return {
        center: [centerLng, centerLat] as [number, number],
        zoomLevel: 15, // Default zoom for single point
      };
    }

    // Add padding factor (smaller view = need to zoom out more)
    const paddingFactor = 1.5;
    const latZoom = Math.log2(180 / (latSpan * paddingFactor || 0.001));
    const lngZoom = Math.log2(360 / (lngSpan * paddingFactor || 0.001));

    // Use the smaller zoom (shows more area) and clamp to reasonable range
    const calculatedZoom = Math.min(latZoom, lngZoom);
    const clampedZoom = Math.max(1, Math.min(18, isFinite(calculatedZoom) ? calculatedZoom : 10));

    return {
      center: [centerLng, centerLat] as [number, number],
      zoomLevel: clampedZoom,
    };
  }, [bounds]);

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

  // No GPS data available for this activity (stream_types doesn't include latlng)
  if (!hasGpsData) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  // Still loading streams
  if (isLoading) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '10' }]}>
        <ActivityIndicator size="small" color={activityColor} />
      </View>
    );
  }

  // Loaded but no valid GPS data (empty or all NaN coordinates)
  if (!bounds || validCoordinates.length === 0) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { height }]}
      testID={mapReady ? `activity-map-preview-ready-${activity.id}` : undefined}
    >
      <MapView
        key={`map-preview-${activity.id}-${mapKey}`}
        style={styles.map}
        mapStyle={styleUrl}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onDidFinishLoadingMap={handleMapFullyRendered}
        onDidFailLoadingMap={handleMapLoadError}
      >
        <Camera
          defaultSettings={{
            bounds: {
              ne: bounds ? [bounds.ne[0], bounds.ne[1]] : [0, 0],
              sw: bounds ? [bounds.sw[0], bounds.sw[1]] : [0, 0],
            },
            padding: { paddingTop: 50, paddingRight: 30, paddingBottom: 75, paddingLeft: 30 },
            animationMode: 'moveTo',
            animationDuration: 0,
          }}
        />

        {/* Route line - iOS crash fix: always render ShapeSource */}
        <ShapeSource id="routeSource" shape={routeGeoJSON}>
          <LineLayer
            id="routeLineCasing"
            style={{
              lineColor: '#FFFFFF',
              lineOpacity: hasRouteData ? 1 : 0,
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
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
        </ShapeSource>

        {/* Start marker */}
        {/* iOS CRASH FIX: Always render MarkerView to maintain stable child count */}
        {/* Use opacity to hide when point is undefined */}
        <MarkerView coordinate={startPoint ? [startPoint.longitude, startPoint.latitude] : [0, 0]}>
          <View style={[styles.markerContainer, { opacity: startPoint ? 1 : 0 }]}>
            <View style={[styles.marker, styles.startMarker]} />
          </View>
        </MarkerView>

        {/* End marker */}
        {/* iOS CRASH FIX: Always render MarkerView to maintain stable child count */}
        <MarkerView coordinate={endPoint ? [endPoint.longitude, endPoint.latitude] : [0, 0]}>
          <View style={[styles.markerContainer, { opacity: endPoint ? 1 : 0 }]}>
            <View style={[styles.marker, styles.endMarker]} />
          </View>
        </MarkerView>
      </MapView>
      {/* Loading overlay - shows during stagger period only */}
      {/* mapReady callback is unreliable on Android, so we use deterministic stagger timing */}
      {!showMapContent && (
        <View style={[styles.loadingOverlay, { backgroundColor: activityColor + '10' }]}>
          <ActivityIndicator size="small" color={activityColor} />
        </View>
      )}
      {/* Error overlay - shows when map fails to load */}
      {mapError && (
        <View style={[styles.loadingOverlay, { backgroundColor: activityColor + '20' }]}>
          <MaterialCommunityIcons name="map-marker-alert" size={24} color={activityColor} />
        </View>
      )}
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textOnDark,
  },
  startMarker: {
    backgroundColor: 'rgba(34,197,94,0.75)',
  },
  endMarker: {
    backgroundColor: 'rgba(239,68,68,0.75)',
  },
});
