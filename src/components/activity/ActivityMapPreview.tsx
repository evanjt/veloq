import React, { useMemo, useState, useEffect } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { Canvas, Path, Circle, Skia } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor, getMapLibreBounds } from '@/lib';
import { useMapPreferences } from '@/providers';
import { StaticCompassArrow } from '@/shared/ui';
import { projectRouteToBox } from '@/lib/geo/routePreview';
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
import { brand, colors, mapPreviewColors, colorWithOpacity } from '@/theme';
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

  // Container width for the static route preview (Skia needs explicit size).
  const [boxW, setBoxW] = useState(0);

  // Check if activity has GPS data available
  const hasGpsData = activity.stream_types?.includes('latlng');

  // Engine-first GPS coordinates (startup pre-fetched → engine SQLite → API fallback)
  const {
    coordinates: validCoordinates,
    altitude,
    isLoading,
  } = useMapPreviewCoordinates(activity.id, !!hasGpsData, startupTrack);

  const bounds = useMemo(() => getMapLibreBounds(validCoordinates), [validCoordinates]);

  // Project the route to pixel points that fit the card box, then build Skia
  // paths. A static line preview replaces the per-card live MapLibre MapView —
  // the GL contexts were the feed's dominant render cost. The full interactive
  // map lives on the activity detail screen.
  const routePoints = useMemo(
    () => projectRouteToBox(validCoordinates, boxW, height),
    [validCoordinates, boxW, height]
  );

  const routePath = useMemo(() => {
    if (routePoints.length < 2) return null;
    const p = Skia.Path.Make();
    p.moveTo(routePoints[0].x, routePoints[0].y);
    for (let i = 1; i < routePoints.length; i++) p.lineTo(routePoints[i].x, routePoints[i].y);
    return p;
  }, [routePoints]);

  // PR section highlights (gold) — slice the same projected points by index range.
  const prPaths = useMemo(() => {
    if (!prSectionIndices || prSectionIndices.length === 0 || routePoints.length < 2) return [];
    const paths: ReturnType<typeof Skia.Path.Make>[] = [];
    for (const range of prSectionIndices) {
      const start = Math.max(0, range.startIndex);
      const end = Math.min(routePoints.length, range.endIndex + 1);
      if (end - start < 2) continue;
      const p = Skia.Path.Make();
      p.moveTo(routePoints[start].x, routePoints[start].y);
      for (let i = start + 1; i < end; i++) p.lineTo(routePoints[i].x, routePoints[i].y);
      paths.push(p);
    }
    return paths;
  }, [prSectionIndices, routePoints]);

  const startPoint = routePoints[0];
  const endPoint = routePoints[routePoints.length - 1];

  // Memoize terrain camera: use user override if saved, else auto-calculate
  const terrainCameraResult = useMemo(() => {
    if (!maybeShow3D || validCoordinates.length < 2) return null;
    const override = getCameraOverride(activity.id);
    if (override) return { camera: override, hasInterestingTerrain: true } as const;
    const lngLatCoords: [number, number][] = validCoordinates.map((c) => [c.longitude, c.latitude]);
    return calculateTerrainCamera(lngLatCoords, altitude);
  }, [maybeShow3D, validCoordinates, altitude, activity.id]);

  // Final decision: should we render 3D?
  // When altitude data is available, trust the camera analysis. When unavailable
  // (e.g. preview tracks from route signatures lose elevation during DP simplification),
  // fall back to the activity-metadata pre-filter which uses total_elevation_gain.
  const cameraConfirmed = terrainCameraResult?.hasInterestingTerrain === true;
  const noAltitudeData = !altitude || altitude.length === 0;
  const show3D =
    terrain3DMode === 'always' ||
    (terrain3DMode === 'smart' && (cameraConfirmed || (noAltitudeData && maybeShow3D)));

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

  // Static route-line preview (no live map / GL context). The detail screen has
  // the full interactive map; the feed just needs a fast, correct route shape.
  return (
    <View
      style={[styles.container, { height, backgroundColor: activityColor + '14' }]}
      onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
      testID={routePath ? `activity-map-preview-ready-${activity.id}` : undefined}
    >
      {boxW > 0 && routePath && (
        <Canvas style={{ width: boxW, height }}>
          <Path
            path={routePath}
            color={mapPreviewColors.routeHalo}
            style="stroke"
            strokeWidth={4}
            strokeJoin="round"
            strokeCap="round"
          />
          <Path
            path={routePath}
            color={activityColor}
            style="stroke"
            strokeWidth={3}
            strokeJoin="round"
            strokeCap="round"
          />
          {prPaths.map((p, i) => (
            <Path
              key={i}
              path={p}
              color={brand.gold}
              style="stroke"
              strokeWidth={4}
              strokeJoin="round"
              strokeCap="round"
            />
          ))}
          {startPoint && (
            <Circle
              cx={startPoint.x}
              cy={startPoint.y}
              r={5}
              color={colorWithOpacity(colors.success, 0.9)}
            />
          )}
          {endPoint && (
            <Circle
              cx={endPoint.x}
              cy={endPoint.y}
              r={5}
              color={colorWithOpacity(colors.error, 0.9)}
            />
          )}
        </Canvas>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
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
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
