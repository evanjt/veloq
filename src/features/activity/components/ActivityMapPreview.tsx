import React, { useMemo, useRef, useState, useEffect } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useIsFocused } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor } from '@/features/activity/lib/activityUtils';
import { getMapLibreBounds } from '@/shared/geo/polyline';
import { useMapPreferences } from '@/features/maps/stores/MapPreferencesContext';
import { StaticCompassArrow } from '@/shared/ui';
import { useMapPreviewCoordinates } from '../hooks/useMapPreviewCoordinates';
import { isWithinPreviewRange, onPreviewRangeChange } from '../lib/previewRange';
import {
  hasTerrainPreview,
  isTerrainPreviewDowngraded,
  getTerrainPreviewUri,
  isTerrainCacheInitialized,
  onTerrainCacheReady,
  deleteSupersededTerrainPreviews,
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
import { layout } from '@/theme';
import type { Activity } from '@/types';
import type { PreviewTrack } from '@/features/home/hooks/useStartupData';
import { debug } from '@/shared/debug/debug';

const log = debug.create('ActivityMapPreview');

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
  onAttributionClearanceChange,
}: ActivityMapPreviewProps) {
  const mapPreviewStart = __DEV__ && index < 3 ? performance.now() : 0;
  // Read focus locally so a tab switch re-renders only this leaf preview, not the
  // whole ActivityCard. The snapshot effect below defers requests when unfocused.
  const screenFocused = useIsFocused();
  const { getStyleForActivity, getTerrain3DMode, hasActivityOverride } = useMapPreferences();
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
    if (cacheReady) return undefined;
    return onTerrainCacheReady(() => setCacheReady(true));
  }, [cacheReady]);

  // Check if activity has GPS data available
  const hasGpsData = activity.stream_types?.includes('latlng');

  // Engine-first GPS coordinates (startup pre-fetched → engine SQLite → API fallback)
  const {
    coordinates: validCoordinates,
    altitude,
    isLoading,
  } = useMapPreviewCoordinates(activity.id, !!hasGpsData, startupTrack);

  const bounds = useMemo(() => getMapLibreBounds(validCoordinates), [validCoordinates]);

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

  // The snapshot pipeline gave up on this activity: every rung of the failover
  // ladder is exhausted, or it is offline. Distinguished from pending because
  // the two cards are different, a spinner against the "nothing to draw" mark,
  // and a spinner that will never resolve is dishonest.
  const [snapshotFailed, setSnapshotFailed] = useState(false);

  // Reset image when map style or 3D preference changes
  useEffect(() => {
    if (hasTerrainPreview(activity.id, mapStyle, !flat)) {
      setTerrainImageUri(getTerrainPreviewUri(activity.id, mapStyle, !flat));
    } else {
      setTerrainImageUri(null);
    }
  }, [mapStyle, activity.id, cacheReady, flat]);

  // Subscribe to snapshot completion/failure events for this activity.
  //
  // A card the athlete has overridden keeps one render. The renders it
  // supersedes go once the new one has landed, never before, so a failed
  // re-render leaves the card with the image it already had (B416).
  useEffect(() => {
    return subscribeSnapshot(activity.id, (uri) => {
      setSnapshotFailed(false);
      setTerrainImageUri(uri);
      if (hasActivityOverride(activity.id)) {
        void deleteSupersededTerrainPreviews(activity.id, mapStyle, !flat);
      }
    });
  }, [activity.id, hasActivityOverride, mapStyle, flat]);

  useEffect(() => {
    return subscribeSnapshotFailure(activity.id, () => {
      setSnapshotFailed(true);
    });
  }, [activity.id]);

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
  // Mounted is not the same as near enough to be worth rendering. The list
  // keeps two to three screens either side alive for smooth scrolling; a render
  // is only worth starting for a card on screen or one screen from it, and this
  // re-asks that question when the feed says the viewport moved.
  const [inRange, setInRange] = useState(() => isWithinPreviewRange(index));
  useEffect(() => {
    const update = () => setInRange(isWithinPreviewRange(index));
    update();
    return onPreviewRangeChange(update);
  }, [index]);

  useEffect(() => {
    if (!screenFocused) return;
    if (!inRange) return;
    if (validCoordinates.length < 2) return;
    // What is on screen and what to ask for are two decisions. A flat stand-in
    // is served either way, because a card is never blanked to redraw it, but
    // it is not the render that was asked for, so the card asks again. The pool
    // caps how often.
    const downgraded = isTerrainPreviewDowngraded(activity.id, mapStyle, !flat);
    if (hasTerrainPreview(activity.id, mapStyle, !flat)) {
      setTerrainImageUri(getTerrainPreviewUri(activity.id, mapStyle, !flat));
      if (!downgraded) return;
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
      // The athlete changed this one card's map, so it does not wait behind
      // every card the feed has mounted (B416).
      priority: hasActivityOverride(activity.id),
      upgrade: downgraded,
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
    hasActivityOverride,
    inRange,
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

  // Snapshot pending. A card waits on the spinner however long the queue takes:
  // only the pipeline saying it gave up moves it off, so a slow render is never
  // dressed up as a failed one.
  if (!snapshotFailed) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '10' }]}>
        <ActivityIndicator size="small" color={activityColor} />
      </View>
    );
  }

  // Every rung of the ladder is exhausted. The card has a track and cannot draw
  // it, which is the same thing as having no track to draw, so it takes the
  // settled mark for that rather than a spinner nothing will ever resolve.
  return (
    <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
      <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
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
    borderRadius: layout.borderRadiusFull,
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
