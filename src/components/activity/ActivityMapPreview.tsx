import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Image, StyleSheet, ActivityIndicator, Platform } from 'react-native';

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
import { StaticCompassArrow } from '@/components/ui';
import { useActivityStreams } from '@/hooks';
import { hasTerrainPreview, getTerrainPreviewUri } from '@/lib/storage/terrainPreviewCache';
import { getCameraOverride } from '@/lib/storage/terrainCameraOverrides';
import { subscribeSnapshot } from '@/lib/events/terrainSnapshotEvents';
import { calculateTerrainCamera } from '@/lib/utils/cameraAngle';
import type { TerrainSnapshotWebViewRef } from '@/components/maps/TerrainSnapshotWebView';
import type { Activity } from '@/types';

interface ActivityMapPreviewProps {
  activity: Activity;
  height?: number;
  index?: number;
  /** Ref to the shared snapshot WebView for requesting 3D terrain previews */
  snapshotRef?: React.RefObject<TerrainSnapshotWebViewRef | null>;
}

export function ActivityMapPreview({
  activity,
  height = 160,
  index = 0,
  snapshotRef,
}: ActivityMapPreviewProps) {
  const { getStyleForActivity, isTerrain3DEnabled } = useMapPreferences();
  const mapStyle = getStyleForActivity(activity.type);
  const activityColor = getActivityColor(activity.type);
  const terrain3D = isTerrain3DEnabled(activity.type);

  // Track whether we have a cached 3D terrain image
  const [terrainImageUri, setTerrainImageUri] = useState<string | null>(() => {
    if (terrain3D && hasTerrainPreview(activity.id, mapStyle)) {
      return getTerrainPreviewUri(activity.id, mapStyle);
    }
    return null;
  });

  // Reset terrain image when map style or 3D preference changes
  useEffect(() => {
    if (terrain3D && hasTerrainPreview(activity.id, mapStyle)) {
      setTerrainImageUri(getTerrainPreviewUri(activity.id, mapStyle));
    } else {
      setTerrainImageUri(null);
    }
  }, [terrain3D, mapStyle, activity.id]);

  // Subscribe to snapshot completion events for this activity
  useEffect(() => {
    if (!terrain3D) return;
    return subscribeSnapshot(activity.id, (uri) => {
      setTerrainImageUri(uri);
    });
  }, [terrain3D, activity.id]);
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

  // Memoize terrain camera: use user override if saved, else auto-calculate
  const terrainCamera = useMemo(() => {
    if (!terrain3D || validCoordinates.length < 2) return null;
    const override = getCameraOverride(activity.id);
    if (override) return override;
    const lngLatCoords: [number, number][] = validCoordinates.map((c) => [c.longitude, c.latitude]);
    return calculateTerrainCamera(lngLatCoords, streams?.altitude);
  }, [terrain3D, validCoordinates, streams?.altitude, activity.id]);

  // Request 3D terrain snapshot when enabled and coordinates are available
  // Only cards within the first N positions request snapshots to limit queue pressure
  useEffect(() => {
    if (!terrain3D || !snapshotRef?.current || !terrainCamera) return;
    if (hasTerrainPreview(activity.id, mapStyle)) {
      setTerrainImageUri(getTerrainPreviewUri(activity.id, mapStyle));
      return;
    }

    const lngLatCoords: [number, number][] = validCoordinates.map((c) => [c.longitude, c.latitude]);

    console.log(`[ActivityMapPreview] Requesting 3D snapshot for ${activity.id}`);
    snapshotRef.current.requestSnapshot({
      activityId: activity.id,
      coordinates: lngLatCoords,
      camera: terrainCamera,
      mapStyle,
      routeColor: activityColor,
    });
  }, [
    terrain3D,
    terrainCamera,
    validCoordinates,
    activity.id,
    mapStyle,
    activityColor,
    snapshotRef,
  ]);

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

  // Show cached 3D terrain image when available
  if (terrain3D && terrainImageUri) {
    const bearing = terrainCamera?.bearing ?? 0;
    return (
      <View style={[styles.container, { height }]}>
        <Image source={{ uri: terrainImageUri }} style={styles.terrainImage} resizeMode="cover" />
        {Math.abs(bearing) > 5 && (
          <View style={styles.compassOverlay}>
            <StaticCompassArrow bearing={bearing} size={16} southColor="rgba(255,255,255,0.7)" />
          </View>
        )}
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
  terrainImage: {
    flex: 1,
  },
  compassOverlay: {
    position: 'absolute',
    bottom: 68,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
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
