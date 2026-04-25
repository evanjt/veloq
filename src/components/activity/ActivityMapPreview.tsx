import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Image, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  MarkerView,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor, getMapLibreBounds } from '@/lib';
import { colors } from '@/theme';
import { useMapPreferences } from '@/providers';
import { getMapStyle } from '@/components/maps';
import { StaticCompassArrow } from '@/components/ui';
import { useMapPreviewCoordinates } from '@/hooks/activities/useMapPreviewCoordinates';
import {
  hasTerrainPreview,
  getTerrainPreviewUri,
  isTerrainPreviewDirty,
  clearTerrainPreviewDirty,
  deleteTerrainPreviewsForActivity,
  isPrioritySnapshot,
  clearPrioritySnapshot,
  isTerrainCacheInitialized,
  onTerrainCacheReady,
} from '@/lib/storage/terrainPreviewCache';
import { getCameraOverride } from '@/lib/storage/terrainCameraOverrides';
import { subscribeSnapshot } from '@/lib/events/terrainSnapshotEvents';
import { calculateTerrainCamera, isLikelyInterestingTerrain } from '@/lib/utils/cameraAngle';
import type { TerrainSnapshotWebViewRef } from '@/components/maps/TerrainSnapshotWebView';
import type { Activity } from '@/types';
import type { PreviewTrack } from '@/hooks/home/useStartupData';

interface ActivityMapPreviewProps {
  activity: Activity;
  height?: number;
  index?: number;
  /** Ref to the shared snapshot WebView for requesting 3D terrain previews */
  snapshotRef?: React.RefObject<TerrainSnapshotWebViewRef | null>;
  /** Whether the parent screen is focused — defers snapshot requests when false */
  screenFocused?: boolean;
  /** Pre-fetched GPS track from startup data (avoids individual FFI/API calls) */
  startupTrack?: PreviewTrack;
  /** Whether the snapshot WebView workers are mounted and ready */
  snapshotReady?: boolean;
  /** GPS track index ranges for PR sections to highlight in gold */
  prSectionIndices?: Array<{ startIndex: number; endIndex: number }>;
}

export const ActivityMapPreview = React.memo(function ActivityMapPreview({
  activity,
  height = 160,
  index = 0,
  snapshotRef,
  screenFocused = true,
  snapshotReady = false,
  startupTrack,
  prSectionIndices,
}: ActivityMapPreviewProps) {
  const mapPreviewStart = __DEV__ && index < 3 ? performance.now() : 0;
  const { getStyleForActivity, getTerrain3DMode } = useMapPreferences();
  const mapStyle = getStyleForActivity(activity.type, activity.id, activity.country);
  const activityColor = getActivityColor(activity.type);
  const terrain3DMode = getTerrain3DMode(activity.type, activity.id);

  // Fast pre-filter: skip 3D entirely for obviously flat activities
  const maybeShow3D =
    terrain3DMode === 'always' ||
    (terrain3DMode === 'smart' &&
      isLikelyInterestingTerrain(activity.total_elevation_gain, activity.distance));

  const [cacheReady, setCacheReady] = useState(() => isTerrainCacheInitialized());
  useEffect(() => {
    if (cacheReady) return;
    return onTerrainCacheReady(() => setCacheReady(true));
  }, [cacheReady]);

  // Track whether we have a cached 3D terrain image
  const [terrainImageUri, setTerrainImageUri] = useState<string | null>(() => {
    if (maybeShow3D && hasTerrainPreview(activity.id, mapStyle)) {
      return getTerrainPreviewUri(activity.id, mapStyle);
    }
    return null;
  });

  // Reset terrain image when map style or 3D preference changes
  useEffect(() => {
    if (maybeShow3D && hasTerrainPreview(activity.id, mapStyle)) {
      setTerrainImageUri(getTerrainPreviewUri(activity.id, mapStyle));
    } else {
      setTerrainImageUri(null);
    }
  }, [maybeShow3D, mapStyle, activity.id, cacheReady]);

  // Subscribe to snapshot completion events for this activity
  useEffect(() => {
    if (!maybeShow3D) return;
    return subscribeSnapshot(activity.id, (uri) => {
      setTerrainImageUri(uri);
    });
  }, [maybeShow3D, activity.id]);
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
    // Short stagger to prevent tile request floods; capped at 250ms for all cards
    const delay = Math.min(index * 50, 250);
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

  // Engine-first GPS coordinates (startup pre-fetched → engine SQLite → API fallback)
  const {
    coordinates: validCoordinates,
    altitude,
    isLoading,
  } = useMapPreviewCoordinates(activity.id, !!hasGpsData, startupTrack);

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

  // Build GeoJSON for PR section highlights (gold overlay on the activity trace)
  const prSectionGeoJSON = useMemo(() => {
    if (!prSectionIndices || prSectionIndices.length === 0 || validCoordinates.length < 2) {
      return null;
    }
    const features: Array<{
      type: 'Feature';
      properties: { index: number };
      geometry: { type: 'LineString'; coordinates: number[][] };
    }> = [];
    prSectionIndices.forEach((range, i) => {
      const start = Math.max(0, range.startIndex);
      const end = Math.min(validCoordinates.length, range.endIndex + 1);
      if (end - start < 2) return;
      const slice = validCoordinates.slice(start, end);
      features.push({
        type: 'Feature' as const,
        properties: { index: i },
        geometry: {
          type: 'LineString' as const,
          coordinates: slice.map((c) => [c.longitude, c.latitude]),
        },
      });
    });
    if (features.length === 0) return null;
    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [prSectionIndices, validCoordinates]);

  const styleUrl = getMapStyle(mapStyle);
  const startPoint = validCoordinates[0];
  const endPoint = validCoordinates[validCoordinates.length - 1];

  // Memoize LineLayer styles to avoid re-creating objects on every render
  const casingStyle = useMemo(
    () => ({
      lineColor: '#FFFFFF',
      lineOpacity: hasRouteData ? 1 : 0,
      lineWidth: 4,
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
    }),
    [hasRouteData]
  );
  const routeLineStyle = useMemo(
    () => ({
      lineColor: activityColor,
      lineOpacity: hasRouteData ? 1 : 0,
      lineWidth: 3,
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
    }),
    [hasRouteData, activityColor]
  );
  const prLineStyle = useMemo(
    () => ({
      lineColor: '#D4AF37',
      lineOpacity: 1,
      lineWidth: 4,
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
    }),
    []
  );

  // Memoize terrain camera: use user override if saved, else auto-calculate
  const terrainCameraResult = useMemo(() => {
    if (!maybeShow3D || validCoordinates.length < 2) return null;
    const override = getCameraOverride(activity.id);
    if (override) return { camera: override, hasInterestingTerrain: true } as const;
    const lngLatCoords: [number, number][] = validCoordinates.map((c) => [c.longitude, c.latitude]);
    return calculateTerrainCamera(lngLatCoords, altitude);
  }, [maybeShow3D, validCoordinates, altitude, activity.id]);

  // Final decision: should we render 3D?
  const show3D =
    terrain3DMode === 'always' ||
    (terrain3DMode === 'smart' && terrainCameraResult?.hasInterestingTerrain === true);

  // Request 3D terrain snapshot when enabled and coordinates are available
  // Only cards within the first N positions request snapshots to limit queue pressure
  // Priority activities (from background notification ingestion) bypass the index gate
  // Deferred until the feed screen is focused — avoids competing with the detail view's Map3DWebView
  useEffect(() => {
    if (!screenFocused) return;
    if (!show3D || !terrainCameraResult) return;
    const hasPriority = isPrioritySnapshot(activity.id);
    if (index >= 10 && !hasPriority) return; // Don't queue snapshots for far-off cards
    // The priority flag exists solely to bypass the index gate above. Clear it
    // now so a subsequent early return (e.g. snapshotRef not ready on first
    // render) doesn't leave the flag stuck in the priority set.
    if (hasPriority) clearPrioritySnapshot(activity.id);

    // If dirty (style/3D changed in detail view), delete old preview first
    if (isTerrainPreviewDirty(activity.id)) {
      deleteTerrainPreviewsForActivity(activity.id).then(() => {
        clearTerrainPreviewDirty(activity.id);
      });
      // Fall through to request new snapshot below
    } else if (hasTerrainPreview(activity.id, mapStyle)) {
      setTerrainImageUri(getTerrainPreviewUri(activity.id, mapStyle));
      return;
    }

    // If WebView workers aren't available yet, skip — they'll mount shortly (500ms deferred)
    // and the effect re-runs when snapshotReady changes
    if (!snapshotRef?.current) return;

    const lngLatCoords: [number, number][] = validCoordinates.map((c) => [c.longitude, c.latitude]);

    console.log(`[ActivityMapPreview] Requesting 3D snapshot for ${activity.id}`);
    snapshotRef.current.requestSnapshot({
      activityId: activity.id,
      coordinates: lngLatCoords,
      camera: terrainCameraResult.camera,
      mapStyle,
      routeColor: activityColor,
    });
  }, [
    screenFocused,
    show3D,
    terrainCameraResult,
    validCoordinates,
    activity.id,
    mapStyle,
    activityColor,
    snapshotRef,
    snapshotReady,
  ]);

  if (__DEV__ && mapPreviewStart && index < 3) {
    const hookTime = performance.now() - mapPreviewStart;
    const source = startupTrack
      ? 'startup'
      : validCoordinates.length > 0
        ? 'engine'
        : isLoading
          ? 'loading'
          : 'none';
    const render3d = show3D && terrainImageUri ? '3D-cached' : show3D ? '3D-pending' : '2D';
    console.log(
      `    🗺️ MapPreview[${index}] hooks: ${hookTime.toFixed(0)}ms | coords: ${validCoordinates.length} | source: ${source} | ${render3d}`
    );
  }

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
  if (show3D && terrainImageUri) {
    const bearing = terrainCameraResult?.camera.bearing ?? 0;
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
          <LineLayer id="routeLineCasing" style={casingStyle} />
          <LineLayer id="routeLine" style={routeLineStyle} />
        </ShapeSource>

        {/* PR section highlights in gold */}
        {prSectionGeoJSON && (
          <ShapeSource id="prSectionSource" shape={prSectionGeoJSON}>
            <LineLayer id="prSectionLine" style={prLineStyle} />
          </ShapeSource>
        )}

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
});

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
