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
import type { Camera } from '@maplibre/maplibre-react-native';
import { normalizeBounds, getBoundsCenter } from '@/lib';
import { getMapCameraState } from '@/lib/storage/mapCameraState';
import type { ActivityBoundsItem } from '@/types';
import type { RouteSignature } from '@/hooks/routes';

interface UseMapCameraOptions {
  activities: ActivityBoundsItem[];
  routeSignatures: Record<string, RouteSignature>;
  /** Incremented on iOS retry — resets camera state so initial position is reapplied */
  mapKey: number;
  cameraRef: React.RefObject<React.ElementRef<typeof Camera> | null>;
}

interface UseMapCameraResult {
  activityCenters: Record<string, [number, number]>;
  mapCenter: [number, number] | null;
  currentCenter: [number, number] | null;
  currentZoom: number;
  setCurrentCenter: (v: [number, number] | null) => void;
  setCurrentZoom: (v: number) => void;
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
  const [currentZoom, setCurrentZoom] = useState(10);
  const [currentCenter, setCurrentCenter] = useState<[number, number] | null>(null);

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

  // Calculate bounds from activities (used for initial camera position and auto-reposition)
  // Uses normalizeBounds to auto-detect coordinate format from API
  //
  // Compact areas (zoom >= 4, sub-continental scale):
  //   fitBounds to the full extent with 500ms animation
  //
  // World-spanning areas (zoom < 4, e.g. US + Europe):
  //   setCamera to the most recent activity's center at a sensible zoom (instant, no animation).
  //   fitBounds on a multi-continent extent produces an ocean view and its animation fights
  //   user pan gestures while it runs.
  const calculateBoundsAndCenter = useCallback(
    (activityList: ActivityBoundsItem[]): BoundsData | null => {
      if (activityList.length === 0) return null;

      let minLat = Infinity,
        maxLat = -Infinity;
      let minLng = Infinity,
        maxLng = -Infinity;

      for (const activity of activityList) {
        const normalized = normalizeBounds(activity.bounds);
        minLat = Math.min(minLat, normalized.minLat);
        maxLat = Math.max(maxLat, normalized.maxLat);
        minLng = Math.min(minLng, normalized.minLng);
        maxLng = Math.max(maxLng, normalized.maxLng);
      }

      // Calculate zoom level based on full bounds span
      // Using Mercator projection formula: zoom = log2(360 / lonSpan) or log2(180 / latSpan)
      const latSpan = maxLat - minLat;
      const lngSpan = maxLng - minLng;
      const latZoom = Math.log2(180 / (latSpan || 1)) - 0.5;
      const lngZoom = Math.log2(360 / (lngSpan || 1)) - 0.5;
      // Use the smaller zoom (shows more area) to fit all activities
      const zoomLevel = Math.max(1, Math.min(latZoom, lngZoom));

      const COMPACT_AREA_MIN_ZOOM = 4;
      const worldSpanning = zoomLevel < COMPACT_AREA_MIN_ZOOM;

      let centerLng: number, centerLat: number;
      let targetBounds: { ne: [number, number]; sw: [number, number] };
      let recentZoom: number;

      if (!worldSpanning) {
        centerLng = (minLng + maxLng) / 2;
        centerLat = (minLat + maxLat) / 2;
        targetBounds = {
          ne: [maxLng, maxLat] as [number, number],
          sw: [minLng, minLat] as [number, number],
        };
        recentZoom = zoomLevel; // unused in compact path
      } else {
        // World-spanning: target the most recent single activity, not the midpoint of the ocean.
        const sortedByDate = [...activityList].sort((a, b) =>
          (b.date || '').localeCompare(a.date || '')
        );
        const recentBounds = normalizeBounds(sortedByDate[0].bounds);
        centerLng = (recentBounds.minLng + recentBounds.maxLng) / 2;
        centerLat = (recentBounds.minLat + recentBounds.maxLat) / 2;

        // Compute zoom from the single activity's bounds — generous padding so context is visible.
        // Capped 9–12: prevents zooming to a useless world view or an extreme street-level zoom.
        const rLatSpan = recentBounds.maxLat - recentBounds.minLat;
        const rLngSpan = recentBounds.maxLng - recentBounds.minLng;
        const rLatZoom = Math.log2(180 / (rLatSpan || 0.1)) - 1.0;
        const rLngZoom = Math.log2(360 / (rLngSpan || 0.1)) - 1.0;
        recentZoom = Math.max(9, Math.min(12, Math.min(rLatZoom, rLngZoom)));

        // targetBounds is set to the recent activity for logging; camera uses setCamera not fitBounds
        targetBounds = {
          ne: [recentBounds.maxLng, recentBounds.maxLat] as [number, number],
          sw: [recentBounds.minLng, recentBounds.minLat] as [number, number],
        };
      }

      return {
        bounds: {
          ne: [maxLng, maxLat] as [number, number],
          sw: [minLng, minLat] as [number, number],
        },
        targetBounds,
        center: [centerLng, centerLat] as [number, number],
        zoomLevel,
        worldSpanning,
        recentZoom,
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

  // Initialize currentCenter from mapCenter for region-aware satellite source detection
  // This effect runs when mapCenter is computed from activities and currentCenter hasn't been set yet
  useEffect(() => {
    if (mapCenter !== null && currentCenter === null) {
      setCurrentCenter(mapCenter);
    }
  }, [currentCenter, mapCenter]);

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

  /** Apply the computed camera position. Extracted to avoid duplication between the
   *  immediate path (markUserInteracted) and the fallback effect.
   *
   *  Priority 1: Restore persisted camera position (user's last-viewed location).
   *  Priority 2: First-ever open — use computed bounds from activity data. */
  const applyPosition = useCallback(
    (data: BoundsData) => {
      hasAutoRepositionedRef.current = true;
      programmaticMoveRef.current = true;

      // Priority 1: Restore persisted camera position (every major map app does this)
      const saved = getMapCameraState();
      if (saved) {
        cameraRef.current?.setCamera({
          centerCoordinate: saved.center,
          zoomLevel: saved.zoom,
          animationDuration: 0,
        });
        setTimeout(() => {
          programmaticMoveRef.current = false;
        }, 100);
        return;
      }

      // Priority 2: First-ever open — use computed bounds
      if (data.worldSpanning) {
        // Multi-continent data: jump instantly to the most recent activity's area.
        // Using setCamera (not fitBounds) avoids a slow animation that fights user pan gestures.
        cameraRef.current?.setCamera({
          centerCoordinate: data.center,
          zoomLevel: data.recentZoom,
          animationDuration: 0,
        });
        setTimeout(() => {
          programmaticMoveRef.current = false;
        }, 100);
      } else {
        // Compact area: animate smoothly to fit all activities in view
        cameraRef.current?.fitBounds(
          data.targetBounds.ne,
          data.targetBounds.sw,
          [60, 40, 260, 40],
          500
        );
        // NOTE: Do NOT call setCamera after fitBounds — resets camera to invalid position (Antarctica bug).
        setTimeout(() => {
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
    if (programmaticMoveRef.current) return;
    if (!settledAfterInitialRef.current) {
      settledAfterInitialRef.current = true;
      setHasCameraSettled(true); // Triggers fallback effect if activities are empty now

      // Immediately reposition if activities are available — no render cycle needed
      if (!hasAutoRepositionedRef.current && activitiesRef.current.length > 0) {
        const data = calculateBoundsRef.current(activitiesRef.current);
        if (data) {
          applyPosition(data);
        }
      }
      return;
    }
    // After initial settle, no-op — auto-reposition uses hasAutoRepositionedRef guard
  }, [cameraRef, applyPosition]);

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
    currentCenter,
    currentZoom,
    setCurrentCenter,
    setCurrentZoom,
    markUserInteracted,
  };
}
