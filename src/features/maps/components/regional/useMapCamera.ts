/**
 * Hook for camera, bounds, and zoom logic in RegionalMapView.
 * Pre-computes activity centers, calculates initial bounds, and positions the
 * camera once the map has settled.
 *
 * WORLD-SPANNING DATA: When activities span multiple continents, fitting the
 * bounds produces a useless world-zoom view and its animation fights user pan
 * gestures. Jump straight to the densest cluster at a sensible zoom instead.
 */

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { normalizeBounds, getBoundsCenter } from '@/shared/geo/polyline';
import type { ActivityBoundsItem } from '@/types';
import type { RouteSignature } from '@/features/routes/hooks';
import type { MapSurfaceRef } from '@/features/maps/components/MapSurface';
import { REGIONAL_FIT_PADDING } from './regionalCamera';

interface UseMapCameraOptions {
  activities: ActivityBoundsItem[];
  routeSignatures: Record<string, RouteSignature>;
  surfaceRef: React.RefObject<MapSurfaceRef | null>;
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
  surfaceRef,
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

      // Check if cluster covers most activities (>= 70%) - if so, just use it.
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

  /** Apply the computed camera position - fit all activities with padding. */
  const applyPosition = useCallback(
    (data: BoundsData) => {
      if (!surfaceRef.current) return;

      hasAutoRepositionedRef.current = true;
      programmaticMoveRef.current = true;

      if (data.worldSpanning) {
        // Multi-continent data: jump instantly to the densest cluster. Fitting
        // world-spanning bounds produces an ocean view.
        surfaceRef.current.setCamera({ center: data.center, zoom: data.recentZoom });
        programmaticMoveRef.current = false;
      } else {
        surfaceRef.current.fitBounds(
          { sw: data.targetBounds.sw, ne: data.targetBounds.ne },
          REGIONAL_FIT_PADDING,
          500
        );
        setTimeout(() => {
          programmaticMoveRef.current = false;
        }, 600);
      }
    },
    [surfaceRef]
  );

  // Callback for handlers to signal when the region changes.
  // First call = initial camera settling. Immediately fires camera command to position at activity
  // region. Subsequent calls while programmaticMoveRef is false = genuine user pan/zoom (no-op).
  //
  // Camera command is fired here (not in a useEffect) to avoid a render-cycle delay between
  // the initial settle and repositioning. The surface must be mounted to have
  // reported a region change at all, so its ref is populated by now.
  const markUserInteracted = useCallback(() => {
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
  }, [applyPosition]);

  // Fallback: auto-reposition if activities arrived AFTER the initial settle.
  // The common path fires the camera command synchronously in markUserInteracted above.
  // This effect only runs when hasCameraSettled becomes true AND activities were empty at settle time.
  useEffect(() => {
    if (!hasCameraSettled) return;
    if (hasAutoRepositionedRef.current) return;
    if (activities.length === 0) return;

    const data = calculateBoundsAndCenter(activities);
    if (!data) return;

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
