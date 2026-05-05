/**
 * Hook for camera, bounds, and zoom logic in RegionalMapView.
 * Pre-computes activity centers, calculates initial bounds,
 * and manages camera settings to prevent Android re-centering.
 *
 * ANDROID BUG: MapLibre re-applies `defaultSettings` on every Camera re-render,
 * even when the JS prop reference is stable. This causes the camera to snap back
 * to the initial position after any state update. Fix: don't use `defaultSettings`
 * at all. Use only the imperative camera API, fired synchronously on first
 * regionDidChange (initial settle), before the user can interact.
 *
 * WORLD-SPANNING DATA: When activities span multiple continents, fitBounds
 * produces a useless world-zoom view and its 500ms animation fights user pan
 * gestures. Instead, use setCamera (instant) to the most recent activity's
 * center at a sensible zoom level.
 */

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { normalizeBounds, getBoundsCenter } from '@/lib';
import { toLngLatBounds, toViewPadding } from '@/lib/maps/bounds';

const FIT_BOUNDS_PADDING = toViewPadding({
  paddingTop: 100,
  paddingRight: 60,
  paddingBottom: 280,
  paddingLeft: 60,
});
import type { ActivityBoundsItem } from '@/types';
import type { RouteSignature } from '@/hooks/routes';

interface UseMapCameraOptions {
  activities: ActivityBoundsItem[];
  routeSignatures: Record<string, RouteSignature>;
  /** Incremented on iOS retry — resets camera state so initial position is reapplied */
  mapKey: number;
  cameraRef: React.RefObject<CameraRef | null>;
}

interface UseMapCameraResult {
  activityCenters: Record<string, [number, number]>;
  mapCenter: [number, number] | null;
  currentZoomRef: React.MutableRefObject<number>;
  currentCenterRef: React.MutableRefObject<[number, number] | null>;
  markUserInteracted: () => void;
}

interface BoundsData {
  bounds: { ne: [number, number]; sw: [number, number] };
  targetBounds: { ne: [number, number]; sw: [number, number] };
  center: [number, number];
  zoomLevel: number;
  /** True when activities span multiple continents (zoomLevel < COMPACT_AREA_MIN_ZOOM) */
  worldSpanning: boolean;
  /** Zoom level for the most recent activity (used when worldSpanning) */
  recentZoom: number;
}

export function useMapCamera({
  activities,
  routeSignatures,
  mapKey,
  cameraRef,
}: UseMapCameraOptions): UseMapCameraResult {
  // Refs for zoom/center avoid re-renders during map gestures.
  // State updates from regionDidChange cause React re-renders that disrupt
  // MapLibre gesture handling on Android, causing camera snap-back.
  const currentZoomRef = useRef(10);
  const currentCenterRef = useRef<[number, number] | null>(null);

  // ===========================================
  // 120HZ OPTIMIZATION: Pre-compute and cache activity start positions
  // ===========================================
  // Uses first point from RouteSignature when available (start of GPS track)
  // Falls back to first latlng point, then bounds center for activities without GPS data
  // This avoids calling getBoundsCenter() (which does format detection) during render
  const activityCenters = useMemo(() => {
    const centers: Record<string, [number, number]> = {};

    for (const activity of activities) {
      // Try to use start point from RouteSignature (first GPS point)
      const signature = routeSignatures[activity.id];
      if (signature?.points?.length > 0) {
        centers[activity.id] = [signature.points[0].lng, signature.points[0].lat];
      } else if (activity.latlngs && activity.latlngs.length > 0) {
        // Fallback: use first latlng from cached GPS data (latlngs is [lat, lng] order)
        centers[activity.id] = [activity.latlngs[0][1], activity.latlngs[0][0]];
      } else {
        // Last resort: compute from bounds center
        centers[activity.id] = getBoundsCenter(activity.bounds);
      }
    }

    return centers;
  }, [activities, routeSignatures]);

  const initialBoundsRef = useRef<BoundsData | null>(null);

  // Interaction tracking refs for auto-reposition logic
  const settledAfterInitialRef = useRef(false); // true after first handleRegionDidChange fires (sync check)
  const [hasCameraSettled, setHasCameraSettled] = useState(false); // same, as state to trigger fallback effect
  const programmaticMoveRef = useRef(false); // true while our own camera command is in progress
  // Prevent auto-reposition from firing more than once per camera session.
  // Without this, every 'activities' engine event (background sync, section processing) triggers
  // repositioning, keeping programmaticMoveRef=true indefinitely and blocking user interaction.
  const hasAutoRepositionedRef = useRef(false);

  // Calculate bounds from activities for initial camera position.
  // When activities span multiple regions, finds the densest cluster
  // (where most activities are) rather than zooming out to fit everything.
  const calculateBoundsAndCenter = useCallback(
    (activityList: ActivityBoundsItem[]): BoundsData | null => {
      if (activityList.length === 0) return null;

      // Compute center of each activity
      const centers: { lat: number; lng: number }[] = [];
      for (const activity of activityList) {
        const n = normalizeBounds(activity.bounds);
        centers.push({
          lat: (n.minLat + n.maxLat) / 2,
          lng: (n.minLng + n.maxLng) / 2,
        });
      }

      // Find the densest cluster: for each activity, count how many others are
      // within ~200km (~2 degrees). The activity with the most neighbours defines
      // the cluster center, and the cluster includes all activities within range.
      const CLUSTER_RADIUS_DEG = 2;
      let bestIdx = 0;
      let bestCount = 0;
      for (let i = 0; i < centers.length; i++) {
        let count = 0;
        for (let j = 0; j < centers.length; j++) {
          const dLat = Math.abs(centers[i].lat - centers[j].lat);
          const dLng = Math.abs(centers[i].lng - centers[j].lng);
          if (dLat <= CLUSTER_RADIUS_DEG && dLng <= CLUSTER_RADIUS_DEG) {
            count++;
          }
        }
        if (count > bestCount) {
          bestCount = count;
          bestIdx = i;
        }
      }

      // Collect all activities in the winning cluster
      const clusterActivities: ActivityBoundsItem[] = [];
      for (let j = 0; j < centers.length; j++) {
        const dLat = Math.abs(centers[bestIdx].lat - centers[j].lat);
        const dLng = Math.abs(centers[bestIdx].lng - centers[j].lng);
        if (dLat <= CLUSTER_RADIUS_DEG && dLng <= CLUSTER_RADIUS_DEG) {
          clusterActivities.push(activityList[j]);
        }
      }

      // Compute bounds from the cluster (or all activities if they're all in one cluster)
      let minLat = Infinity,
        maxLat = -Infinity;
      let minLng = Infinity,
        maxLng = -Infinity;
      for (const activity of clusterActivities) {
        const n = normalizeBounds(activity.bounds);
        minLat = Math.min(minLat, n.minLat);
        maxLat = Math.max(maxLat, n.maxLat);
        minLng = Math.min(minLng, n.minLng);
        maxLng = Math.max(maxLng, n.maxLng);
      }

      // Full bounds (all activities) for reference
      let fullMinLat = Infinity,
        fullMaxLat = -Infinity;
      let fullMinLng = Infinity,
        fullMaxLng = -Infinity;
      for (const activity of activityList) {
        const n = normalizeBounds(activity.bounds);
        fullMinLat = Math.min(fullMinLat, n.minLat);
        fullMaxLat = Math.max(fullMaxLat, n.maxLat);
        fullMinLng = Math.min(fullMinLng, n.minLng);
        fullMaxLng = Math.max(fullMaxLng, n.maxLng);
      }

      const centerLng = (minLng + maxLng) / 2;
      const centerLat = (minLat + maxLat) / 2;

      // Check if cluster covers most activities (>= 70%) — if so, just use it.
      // Otherwise fall back to the cluster anyway (better than an ocean view).
      const latSpan = maxLat - minLat;
      const lngSpan = maxLng - minLng;
      const latZoom = Math.log2(180 / (latSpan || 1)) - 0.5;
      const lngZoom = Math.log2(360 / (lngSpan || 1)) - 0.5;
      const zoomLevel = Math.max(1, Math.min(latZoom, lngZoom));

      // World-spanning if even the cluster is huge (unlikely but possible)
      const worldSpanning = zoomLevel < 3;

      return {
        bounds: {
          ne: [fullMaxLng, fullMaxLat] as [number, number],
          sw: [fullMinLng, fullMinLat] as [number, number],
        },
        targetBounds: {
          ne: [maxLng, maxLat] as [number, number],
          sw: [minLng, minLat] as [number, number],
        },
        center: [centerLng, centerLat] as [number, number],
        zoomLevel,
        worldSpanning,
        recentZoom: Math.max(5, Math.min(9, zoomLevel)),
      };
    },
    []
  );

  // Set initial bounds once when we first have activities
  // This prevents the zoom from jumping during background sync
  useEffect(() => {
    if (initialBoundsRef.current === null && activities.length > 0) {
      initialBoundsRef.current = calculateBoundsAndCenter(activities);
    }
  }, [activities, calculateBoundsAndCenter]);

  // Compute center from current activities (always uses most recent activity).
  // Memoized to avoid creating new references on every render, which would trigger
  // cascading re-renders → spurious regionDidChange on Android → snapback.
  const currentData = useMemo(
    () => calculateBoundsAndCenter(activities),
    [activities, calculateBoundsAndCenter]
  );
  const cachedData = initialBoundsRef.current;
  const mapCenter = currentData?.center ?? cachedData?.center ?? null;

  // Initialize currentCenterRef from mapCenter (no re-render needed)
  useEffect(() => {
    if (mapCenter !== null && currentCenterRef.current === null) {
      currentCenterRef.current = mapCenter;
    }
  }, [mapCenter]);

  // Stable refs so markUserInteracted (a useCallback with no deps) can access current values.
  // Avoids adding activities/calculateBoundsAndCenter as deps, which would recreate the callback
  // on every render and destabilise handleRegionDidChange in useMapHandlers.
  const activitiesRef = useRef(activities);
  activitiesRef.current = activities;
  const calculateBoundsRef = useRef(calculateBoundsAndCenter);
  calculateBoundsRef.current = calculateBoundsAndCenter;

  // Reset camera state when map remounts (iOS retry) so initial position is reapplied
  useEffect(() => {
    if (mapKey > 0) {
      hasAutoRepositionedRef.current = false;
      settledAfterInitialRef.current = false;
      setHasCameraSettled(false);
    }
  }, [mapKey]);

  /** Apply the computed camera position — fit all activities with padding.
   *  Uses fitBounds for proper pixel-based padding, then releases MapLibre
   *  tracking state to prevent snap-back (same pattern as handleFitAll). */
  const applyPosition = useCallback(
    (data: BoundsData) => {
      if (__DEV__) {
        console.log(
          `[CAM] applyPosition — worldSpanning=${data.worldSpanning} zoom=${data.zoomLevel.toFixed(1)} center=[${data.center[0].toFixed(3)},${data.center[1].toFixed(3)}]`
        );
      }
      hasAutoRepositionedRef.current = true;
      programmaticMoveRef.current = true;

      if (data.worldSpanning) {
        // Multi-continent data: jump instantly to the most recent activity's area.
        // fitBounds on world-spanning data produces an ocean view, so use setStop.
        void cameraRef.current?.setStop({
          center: data.center,
          zoom: data.recentZoom,
          duration: 0,
        });
        setTimeout(() => {
          void cameraRef.current?.setStop({ duration: 0 });
          programmaticMoveRef.current = false;
        }, 100);
      } else {
        // Compact area: fitBounds to show all activities with proper padding.
        cameraRef.current?.fitBounds(toLngLatBounds(data.targetBounds), {
          padding: FIT_BOUNDS_PADDING,
          duration: 500,
        });
        // Release MapLibre tracking state after animation completes — without this,
        // the camera snaps back to the bounds after any user gesture.
        setTimeout(() => {
          void cameraRef.current?.setStop({ duration: 0 });
          programmaticMoveRef.current = false;
        }, 600);
      }
    },
    [cameraRef]
  );

  // Callback for handlers to signal when the region changes.
  // First call = initial camera settling. Immediately fires camera command to position at activity
  // region. Subsequent calls while programmaticMoveRef is false = genuine user pan/zoom (no-op).
  //
  // Camera command is fired here (not in a useEffect) to avoid a render-cycle delay between
  // the initial settle and repositioning. cameraRef.current is guaranteed non-null here
  // because Camera must be mounted to fire onRegionDidChange.
  const markUserInteracted = useCallback(() => {
    if (__DEV__) {
      console.log(
        `[CAM] markUserInteracted — programmatic=${programmaticMoveRef.current} settled=${settledAfterInitialRef.current} autoRepos=${hasAutoRepositionedRef.current} activities=${activitiesRef.current.length}`
      );
    }
    if (programmaticMoveRef.current) return;
    if (!settledAfterInitialRef.current) {
      settledAfterInitialRef.current = true;
      setHasCameraSettled(true);

      if (!hasAutoRepositionedRef.current && activitiesRef.current.length > 0) {
        const data = calculateBoundsRef.current(activitiesRef.current);
        if (data) {
          applyPosition(data);
        }
      }
      return;
    }
  }, [cameraRef, applyPosition]);

  // Fallback: auto-reposition if activities arrived AFTER the initial settle.
  // The common path fires the camera command synchronously in markUserInteracted above.
  // This effect only runs when hasCameraSettled becomes true AND activities were empty at settle time.
  useEffect(() => {
    if (__DEV__) {
      console.log(
        `[CAM] fallback effect — settled=${hasCameraSettled} autoRepos=${hasAutoRepositionedRef.current} activities=${activities.length}`
      );
    }
    if (!hasCameraSettled) return;
    if (hasAutoRepositionedRef.current) return;
    if (activities.length === 0) return;

    const data = calculateBoundsAndCenter(activities);
    if (!data) return;

    if (__DEV__) console.log('[CAM] fallback effect → calling applyPosition');
    applyPosition(data);
  }, [activities, hasCameraSettled, calculateBoundsAndCenter, applyPosition]);

  return {
    activityCenters,
    mapCenter,
    currentZoomRef,
    currentCenterRef,
    markUserInteracted,
  };
}
