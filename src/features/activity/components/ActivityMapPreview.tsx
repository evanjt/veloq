import React, { useMemo, useState, useEffect } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useIsFocused } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getActivityColor } from '@/shared/activity/activityUtils';
import { getMapLibreBounds } from '@/shared/geo/polyline';
import {
  calculateFlatCamera,
  deleteSupersededTerrainPreviews,
  deleteTerrainPreview,
  getCameraOverride,
  getTerrainPreviewUri,
  hasTerrainPreview,
  resolveTerrain3D,
  isTerrainCacheInitialized,
  isTerrainPreviewDowngraded,
  onTerrainCacheReady,
  subscribeSnapshot,
  subscribeSnapshotFailure,
  type TerrainSnapshotWebViewRef,
  useMapPreferences,
} from '@/features/maps';
import { StaticCompassArrow } from '@/shared/ui';
import { useIsOnline } from '@/shared/app/NetworkContext';
import { useSyncState } from '@/shared/native/useSyncStatus';
import { useMapPreviewCoordinates } from '../hooks/useMapPreviewCoordinates';
import { isWithinPreviewRange, onPreviewRangeChange } from '../lib/previewRange';
import { mapPreviewState } from '../lib/mapPreviewState';
import { layout, ink, colorWithOpacity } from '@/theme';
import { SyncState } from 'veloqrs';
import type { Activity } from '@/types';
import type { PreviewTrack } from '@/features/home';
import { debug } from '@/shared/debug/debug';
import { freshLoginTimeline } from '@/shared/debug/freshLoginTimeline';

const log = debug.create('ActivityMapPreview');

interface ActivityMapPreviewProps {
  activity: Activity;
  height?: number | undefined;
  index?: number | undefined;
  /** Ref to the shared snapshot WebView for requesting 3D terrain previews */
  snapshotRef?: React.RefObject<TerrainSnapshotWebViewRef | null> | undefined;
  /** Pre-fetched GPS track from startup data (avoids individual FFI/API calls) */
  startupTrack?: PreviewTrack | undefined;
  /** Whether the snapshot WebView workers are mounted and ready */
  snapshotReady?: boolean | undefined;
}

export const ActivityMapPreview = React.memo(function ActivityMapPreview({
  activity,
  height = 160,
  index = 0,
  snapshotRef,
  snapshotReady = false,
  startupTrack,
}: ActivityMapPreviewProps) {
  const mapPreviewStart = __DEV__ && index < 3 ? performance.now() : 0;
  // Read focus locally so a tab switch re-renders only this leaf preview, not the
  // whole ActivityCard. The snapshot effect below defers requests when unfocused.
  const screenFocused = useIsFocused();
  const { getStyleForActivity, getTerrain3DMode, hasActivityOverride } = useMapPreferences();
  const mapStyle = getStyleForActivity(activity.type, activity.id);
  const activityColor = getActivityColor(activity.type);
  const terrain3DMode = getTerrain3DMode(activity.type, activity.id);

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

  // A running sync can still deliver a track this card does not hold yet, so
  // the state is the pair and not the absence alone.
  const syncState = useSyncState();
  const previewState = mapPreviewState({
    hasGpsData: !!hasGpsData,
    isLoading,
    hasTrack: !!bounds && validCoordinates.length > 0,
    isSyncing: syncState === SyncState.Syncing,
  });

  const lngLatCoords = useMemo(
    () => validCoordinates.map((c) => [c.longitude, c.latitude] as [number, number]),
    [validCoordinates]
  );

  // The same verdict the context menu and the detail view show.
  const { show3D, camera: terrainCamera } = useMemo(
    () =>
      resolveTerrain3D({
        mode: terrain3DMode,
        coordinates: lngLatCoords,
        altitude,
        gain: activity.total_elevation_gain,
        distance: activity.distance,
        override: getCameraOverride(activity.id) ?? null,
      }),
    [
      terrain3DMode,
      lngLatCoords,
      altitude,
      activity.total_elevation_gain,
      activity.distance,
      activity.id,
    ]
  );

  const flat = !show3D || !terrainCamera;

  // The camera the snapshot is taken with, and the one the credit line is
  // derived from: satellite sources are regional, so the text has to name the
  // imagery actually baked into the image.
  const snapshotCamera = useMemo(
    () => (!flat && terrainCamera ? terrainCamera : calculateFlatCamera(lngLatCoords)),
    [flat, lngLatCoords, terrainCamera]
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
  // ladder is exhausted. Distinguished from pending because the two cards are
  // different, a spinner against the "nothing to draw" mark, and a spinner
  // that will never resolve is dishonest.
  const [snapshotFailed, setSnapshotFailed] = useState(false);

  // Cached images this card could not decode, for the render it is on. The
  // first is dropped and drawn again; a second means the redraw is broken too,
  // and asking again would loop, so the card settles on the failed mark.
  const [brokenImages, setBrokenImages] = useState(0);

  // Every rung of the ladder needs the network, so offline there is nothing to
  // wait for. Without this the card spins until a terminal failure arrives,
  // which is the 15 s watchdog when idle and the 45 s per-card timer while the
  // athlete keeps scrolling. Read each render rather than latched at mount, so
  // the network coming back puts the card back on the spinner it belongs on.
  const isOnline = useIsOnline();

  // Reset image when map style or 3D preference changes
  useEffect(() => {
    setBrokenImages(0);
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
  // re-render leaves the card with the image it already had.
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
    if (brokenImages > 1) return;
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
      cameraPinned: getCameraOverride(activity.id) !== undefined,
      mapStyle,
      routeColor: activityColor,
      flat: flat || !downgraded,
      standIn: !flat && !downgraded,
      firstPaint: !flat && !downgraded,
      // The athlete changed this one card's map, so it does not wait behind
      // every card the feed has mounted.
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
    brokenImages,
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
  if (previewState === 'noGps') {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  // Still loading streams, or a sync that can still deliver this one.
  if (previewState === 'loading') {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '10' }]}>
        <ActivityIndicator size="small" color={activityColor} />
      </View>
    );
  }

  // The server says this ride has a track and a settled sync left the device
  // with none of it, which is a download owed rather than a ride without GPS.
  // The two drew the same mark, so scrolling back past what has been ingested
  // made every ride there look like an indoor session. The mark is
  // `StrengthTab`'s, which already stands for "awaiting download" on a body
  // the sync has not reached.
  if (previewState === 'awaitingDownload') {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="cloud-download-outline" size={32} color={activityColor} />
      </View>
    );
  }

  // Show the cached basemap snapshot (3D drape or flat) when available
  if (terrainImageUri) {
    const bearing = terrainCamera?.bearing ?? 0;
    return (
      <View
        style={[styles.container, { height }]}
        testID={`activity-map-preview-ready-${activity.id}`}
      >
        <Image
          source={{ uri: terrainImageUri }}
          style={styles.terrainImage}
          resizeMode="cover"
          onLoad={() => freshLoginTimeline.mark('firstMap')}
          onError={({ nativeEvent }) => {
            // Left indexed, the broken file is served again on every mount and
            // the request effect never asks for a new one, so the card spins
            // forever.
            log.log(
              `terrain image failed (${terrainImageUri}): ${nativeEvent?.error ?? 'unknown'} - dropping it`
            );
            void deleteTerrainPreview(activity.id, mapStyle, !flat);
            setTerrainImageUri(null);
            if (brokenImages > 0) setSnapshotFailed(true);
            setBrokenImages((n) => n + 1);
          }}
        />
        {Math.abs(bearing) > 5 && (
          <View style={styles.compassOverlay}>
            <StaticCompassArrow
              bearing={bearing}
              size={16}
              southColor={colorWithOpacity(ink.white, 0.7)}
            />
          </View>
        )}
      </View>
    );
  }

  // Snapshot pending. A card waits on the spinner however long the queue takes:
  // only the pipeline saying it gave up moves it off, so a slow render is never
  // dressed up as a failed one.
  if (!snapshotFailed && isOnline) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '10' }]}>
        <ActivityIndicator size="small" color={activityColor} />
      </View>
    );
  }

  // Every rung of the ladder is exhausted, or offline and out of reach. The
  // card has a track and cannot draw it, which is the same thing as having no
  // track to draw, so it takes the settled mark for that rather than a spinner
  // nothing will ever resolve.
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
    backgroundColor: colorWithOpacity(ink.black, 0.45),
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
