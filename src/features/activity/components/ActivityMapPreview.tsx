import React, { useMemo, useRef, useState, useEffect } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Canvas, Path, Circle, Skia, type SkPath } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor } from '@/features/activity/lib/activityUtils';
import { getMapLibreBounds } from '@/shared/geo/polyline';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import { StaticCompassArrow } from '@/shared/ui';
import { projectRouteToBox } from '@/shared/geo/routePreview';
import { polylineSvgPath } from '@/shared/charts';
import { useMapPreviewCoordinates } from '../hooks/useMapPreviewCoordinates';
import {
  hasTerrainPreview,
  getTerrainPreviewUri,
  isPrioritySnapshot,
  clearPrioritySnapshot,
  isTerrainCacheInitialized,
  onTerrainCacheReady,
} from '@/features/maps/lib/storage/terrainPreviewCache';
import { getCameraOverride } from '@/features/maps/lib/storage/terrainCameraOverrides';
import {
  subscribeSnapshot,
  subscribeSnapshotFailure,
} from '@/features/maps/lib/terrainSnapshotEvents';
import {
  calculateTerrainCamera,
  calculateFlatCamera,
  isLikelyInterestingTerrain,
} from '@/features/maps/lib/cameraAngle';
import type { TerrainSnapshotWebViewRef } from '@/features/maps/components/TerrainSnapshotWebView';
import {
  AttributionOverlay,
  type AttributionOverlayRef,
} from '@/features/maps/components/AttributionOverlay';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import { brand, colors, mapPreviewColors, colorWithOpacity } from '@/theme';
import type { Activity } from '@/types';
import type { PreviewTrack } from '@/features/home/hooks/useStartupData';
import { debug } from '@/shared/debug/debug';

const log = debug.create('ActivityMapPreview');

/** How long a card holds the skeleton before it falls back to the route line. */
const SNAPSHOT_SKELETON_MS = 2000;

interface ActivityMapPreviewProps {
  activity: Activity;
  height?: number;
  index?: number;
  /** Ref to the shared snapshot WebView for requesting 3D terrain previews */
  snapshotRef?: React.RefObject<TerrainSnapshotWebViewRef | null>;
  /** Pre-fetched GPS track from startup data (avoids individual FFI/API calls) */
  startupTrack?: PreviewTrack;
  /** Whether the snapshot WebView workers are mounted and ready */
  snapshotReady?: boolean;
  /** GPS track index ranges for PR sections to highlight in gold */
  prSectionIndices?: { startIndex: number; endIndex: number }[];
  /**
   * Height the attribution pill claims above the preview's bottom edge, zero
   * when no basemap is drawn and so no credit is owed. The card paints its
   * stat rows over this corner and pads itself clear of whatever comes back.
   */
  onAttributionClearanceChange?: (clearance: number) => void;
}

export const ActivityMapPreview = React.memo(function ActivityMapPreview({
  activity,
  height = 160,
  index = 0,
  snapshotRef,
  snapshotReady = false,
  startupTrack,
  prSectionIndices,
  onAttributionClearanceChange,
}: ActivityMapPreviewProps) {
  const mapPreviewStart = __DEV__ && index < 3 ? performance.now() : 0;
  // Read focus locally so a tab switch re-renders only this leaf preview, not the
  // whole ActivityCard. The snapshot effect below defers requests when unfocused.
  const screenFocused = useIsFocused();
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
  // paths. A static line preview replaces the per-card live MapLibre MapView -
  // the GL contexts were the feed's dominant render cost. The full interactive
  // map lives on the activity detail screen.
  const routePoints = useMemo(
    () => projectRouteToBox(validCoordinates, boxW, height),
    [validCoordinates, boxW, height]
  );

  // Build the route line as an SVG path string + MakeFromSVGString - the supported
  // Skia 2.x constructor. The imperative Skia.Path.Make().moveTo()/lineTo() API is
  // deprecated and a path built that way fails to render in the declarative <Path>
  // tree, taking the whole Canvas blank. The SummaryCard sparkline uses this same
  // method, which is why it kept rendering across the SDK 56 Skia bump.
  const routePath = useMemo(() => {
    if (routePoints.length < 2) return null;
    return Skia.Path.MakeFromSVGString(polylineSvgPath(routePoints));
  }, [routePoints]);

  // PR section highlights (gold) - slice the same projected points by index range.
  const prPaths = useMemo(() => {
    if (!prSectionIndices || prSectionIndices.length === 0 || routePoints.length < 2) return [];
    const paths: SkPath[] = [];
    for (const range of prSectionIndices) {
      const start = Math.max(0, range.startIndex);
      const end = Math.min(routePoints.length, range.endIndex + 1);
      if (end - start < 2) continue;
      const p = Skia.Path.MakeFromSVGString(polylineSvgPath(routePoints.slice(start, end)));
      if (p) paths.push(p);
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

  const lngLatCoords = useMemo(
    () => validCoordinates.map((c) => [c.longitude, c.latitude] as [number, number]),
    [validCoordinates]
  );

  const flat = !show3D || !terrainCameraResult;

  // The camera the snapshot is taken with, and the one the credit line is
  // derived from: satellite sources are regional, so the text has to name the
  // imagery actually baked into the image.
  const snapshotCamera = useMemo(
    () => (flat ? calculateFlatCamera(lngLatCoords) : terrainCameraResult.camera),
    [flat, lngLatCoords, terrainCameraResult]
  );

  // Cached basemap snapshot for this activity, style and render. The drape and
  // the flat basemap are two entries, so a 3D toggle is a miss rather than a
  // flag the process has to survive.
  const [terrainImageUri, setTerrainImageUri] = useState<string | null>(() =>
    hasTerrainPreview(activity.id, mapStyle, !flat)
      ? getTerrainPreviewUri(activity.id, mapStyle, !flat)
      : null
  );

  // The snapshot pipeline gave up on this activity (retries exhausted /
  // timeout) - drop from the loading state to the route-line fallback.
  const [snapshotFailed, setSnapshotFailed] = useState(false);

  // Reset image when map style or 3D preference changes
  useEffect(() => {
    if (hasTerrainPreview(activity.id, mapStyle, !flat)) {
      setTerrainImageUri(getTerrainPreviewUri(activity.id, mapStyle, !flat));
    } else {
      setTerrainImageUri(null);
    }
  }, [mapStyle, activity.id, cacheReady, flat]);

  // Subscribe to snapshot completion/failure events for this activity
  useEffect(() => {
    return subscribeSnapshot(activity.id, (uri) => {
      setSnapshotFailed(false);
      setTerrainImageUri(uri);
    });
  }, [activity.id]);

  useEffect(() => {
    return subscribeSnapshotFailure(activity.id, () => {
      setSnapshotFailed(true);
    });
  }, [activity.id]);

  // The queue is two workers deep at 8 s each, so any card past the first few
  // waits longer than a person will. Show the route line rather than a spinner
  // once the skeleton has had its moment; a later completion event flips the
  // card to the image.
  useEffect(() => {
    if (terrainImageUri || snapshotFailed) return;
    const timer = setTimeout(() => setSnapshotFailed(true), SNAPSHOT_SKELETON_MS);
    return () => clearTimeout(timer);
  }, [terrainImageUri, snapshotFailed]);

  // The snapshot generator sets `attributionControl: false`, so nothing is
  // drawn into the image. Attribution is a licence condition, so the card
  // overlays it over the result.
  const attribution = useMemo(
    () =>
      computeAttribution({
        style: mapStyle,
        is3D: !flat,
        center: snapshotCamera.center,
        zoom: snapshotCamera.zoom,
      }),
    [mapStyle, flat, snapshotCamera]
  );

  const attributionRef = useRef<AttributionOverlayRef>(null);
  useEffect(() => {
    attributionRef.current?.setAttribution(attribution);
  }, [attribution]);

  // Without a basemap there is no credit to leave room for, so the card gets
  // its bottom band back rather than holding a gap for a pill that is gone.
  useEffect(() => {
    if (!terrainImageUri) onAttributionClearanceChange?.(0);
  }, [terrainImageUri, onAttributionClearanceChange]);

  // Request a basemap snapshot for every card with coordinates - the 3D
  // terrain drape when the activity qualifies, a flat top-down basemap
  // otherwise. FlatList windowing is the throttle: only near-viewport cards
  // mount.
  // Deferred until the feed screen is focused - avoids competing with the detail view's Map3DWebView
  useEffect(() => {
    if (!screenFocused) return;
    if (validCoordinates.length < 2) return;
    // Clear the priority flag so background-ingested IDs don't accumulate in
    // the priority set.
    if (isPrioritySnapshot(activity.id)) clearPrioritySnapshot(activity.id);

    if (hasTerrainPreview(activity.id, mapStyle, !flat)) {
      setTerrainImageUri(getTerrainPreviewUri(activity.id, mapStyle, !flat));
      return;
    }

    // If WebView workers aren't available yet, skip - they'll mount shortly (500ms deferred)
    // and the effect re-runs when snapshotReady changes
    if (!snapshotRef?.current) return;

    log.log(`Requesting ${flat ? 'flat' : '3D'} snapshot for ${activity.id}`);
    snapshotRef.current.requestSnapshot({
      activityId: activity.id,
      coordinates: lngLatCoords,
      camera: snapshotCamera,
      mapStyle,
      routeColor: activityColor,
      flat,
    });
  }, [
    screenFocused,
    flat,
    snapshotCamera,
    lngLatCoords,
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
    const render3d = terrainImageUri ? 'cached' : show3D ? '3D-pending' : 'flat-pending';
    log.log(
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

  // Show the cached basemap snapshot (3D drape or flat) when available
  if (terrainImageUri) {
    const bearing = terrainCameraResult?.camera.bearing ?? 0;
    return (
      <View
        style={[styles.container, { height }]}
        testID={`activity-map-preview-ready-${activity.id}`}
      >
        <Image
          source={{ uri: terrainImageUri }}
          style={styles.terrainImage}
          resizeMode="cover"
          onError={({ nativeEvent }) => {
            // A missing/undecodable cached snapshot must not leave a blank card -
            // drop back to the 2D route line so the track always renders.
            log.log(
              `terrain image failed (${terrainImageUri}): ${nativeEvent?.error ?? 'unknown'} - falling back to line`
            );
            setTerrainImageUri(null);
          }}
        />
        {Math.abs(bearing) > 5 && (
          <View style={styles.compassOverlay}>
            <StaticCompassArrow bearing={bearing} size={16} southColor="rgba(255,255,255,0.7)" />
          </View>
        )}
        <AttributionOverlay
          ref={attributionRef}
          initialAttribution={attribution}
          onClearanceChange={onAttributionClearanceChange}
        />
      </View>
    );
  }

  // Snapshot pending - neutral loading state. The route line below is reserved
  // for terminal failure (offline, retries exhausted) so a working pipeline
  // always resolves to a basemap, and a broken one never spins forever.
  if (!snapshotFailed) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '10' }]}>
        <ActivityIndicator size="small" color={activityColor} />
      </View>
    );
  }

  // Static route-line fallback (no live map / GL context). Rendered only when
  // the snapshot pipeline gave up; pull-to-refresh retries failed snapshots.
  //
  // The Canvas is always mounted (absoluteFill), never gated behind the
  // onLayout-measured width. A Skia Canvas that first mounts *after* its parent
  // has already laid out renders blank on Android - the native surface misses its
  // first paint. Mounting on the initial render (like the SummaryCard sparkline,
  // whose width comes from props) avoids that. The route Path just appears once
  // boxW is measured and the projection produces points.
  return (
    <View
      style={[styles.container, { height, backgroundColor: activityColor + '14' }]}
      onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
      testID={routePath ? `activity-map-preview-ready-${activity.id}` : undefined}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        {routePath && (
          <Path
            path={routePath}
            color={mapPreviewColors.routeHalo}
            style="stroke"
            strokeWidth={4}
            strokeJoin="round"
            strokeCap="round"
          />
        )}
        {routePath && (
          <Path
            path={routePath}
            color={activityColor}
            style="stroke"
            strokeWidth={3}
            strokeJoin="round"
            strokeCap="round"
          />
        )}
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
