/**
 * Hook for camera, bounds, and zoom logic in RegionalMapView.
 * Pre-computes activity centers, calculates initial bounds,
 * and manages camera settings to prevent Android re-centering.
 */

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { normalizeBounds, getBoundsCenter } from '@/lib';
import type { ActivityBoundsItem } from '@/types';
import type { RouteSignature } from '@/hooks/routes';

interface UseMapCameraOptions {
  activities: ActivityBoundsItem[];
  routeSignatures: Record<string, RouteSignature>;
  /** Incremented on iOS retry — resets camera applied flag so initial position is reapplied */
  mapKey: number;
}

interface UseMapCameraResult {
  activityCenters: Record<string, [number, number]>;
  mapCenter: [number, number] | null;
  mapZoom: number;
  mapBounds: { ne: [number, number]; sw: [number, number] } | null;
  currentCenter: [number, number] | null;
  currentZoom: number;
  setCurrentCenter: (v: [number, number] | null) => void;
  setCurrentZoom: (v: number) => void;
  initialCameraSettings: { centerCoordinate: [number, number]; zoomLevel: number } | undefined;
}

export function useMapCamera({
  activities,
  routeSignatures,
  mapKey,
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
    let fromSignature = 0;
    let fromLatlngs = 0;
    let fromBounds = 0;

    for (const activity of activities) {
      // Try to use start point from RouteSignature (first GPS point)
      const signature = routeSignatures[activity.id];
      if (signature?.points?.length > 0) {
        centers[activity.id] = [signature.points[0].lng, signature.points[0].lat];
        fromSignature++;
      } else if (activity.latlngs && activity.latlngs.length > 0) {
        // Fallback: use first latlng from cached GPS data (latlngs is [lat, lng] order)
        centers[activity.id] = [activity.latlngs[0][1], activity.latlngs[0][0]];
        fromLatlngs++;
      } else {
        // Last resort: compute from bounds center
        centers[activity.id] = getBoundsCenter(activity.bounds);
        fromBounds++;
      }
    }

    return centers;
  }, [activities, routeSignatures]);

  const initialBoundsRef = useRef<{
    bounds: { ne: [number, number]; sw: [number, number] };
    center: [number, number];
    zoomLevel: number;
  } | null>(null);
  // Track if initial camera position has been applied (prevents Android re-centering bug)
  const initialCameraAppliedRef = useRef(false);

  // Calculate bounds from activities (used for initial camera position)
  // Uses normalizeBounds to auto-detect coordinate format from API
  // Returns bounds AND centers on the most recent activity's location
  const calculateBoundsAndCenter = useCallback((activityList: ActivityBoundsItem[]) => {
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

    // Find the most recent activity and center on it
    const sortedByDate = [...activityList].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    const mostRecent = sortedByDate[0];
    const recentBounds = normalizeBounds(mostRecent.bounds);
    const centerLng = (recentBounds.minLng + recentBounds.maxLng) / 2;
    const centerLat = (recentBounds.minLat + recentBounds.maxLat) / 2;

    // Calculate zoom level based on full bounds span
    // Using Mercator projection formula: zoom = log2(360 / lonSpan) or log2(180 / latSpan)
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    // Add padding factor to ensure some margin around activities
    const latZoom = Math.log2(180 / (latSpan || 1)) - 0.5;
    const lngZoom = Math.log2(360 / (lngSpan || 1)) - 0.5;
    // Use the smaller zoom (shows more area) to fit all activities
    const zoomLevel = Math.max(1, Math.min(latZoom, lngZoom));

    return {
      bounds: {
        ne: [maxLng, maxLat] as [number, number],
        sw: [minLng, minLat] as [number, number],
      },
      center: [centerLng, centerLat] as [number, number],
      zoomLevel,
    };
  }, []);

  // Set initial bounds once when we first have activities
  // This prevents the zoom from jumping during background sync
  // But center is always computed fresh to reflect most recent activity
  useEffect(() => {
    if (initialBoundsRef.current === null && activities.length > 0) {
      initialBoundsRef.current = calculateBoundsAndCenter(activities);
    }
  }, [activities, calculateBoundsAndCenter]);

  // Compute center from current activities (always uses most recent activity)
  // But use cached bounds/zoom to prevent jumping during sync
  const currentData = calculateBoundsAndCenter(activities);
  const cachedData = initialBoundsRef.current;
  const mapBounds = cachedData?.bounds ?? currentData?.bounds ?? null;
  const mapCenter = currentData?.center ?? cachedData?.center ?? null;
  const mapZoom = cachedData?.zoomLevel ?? currentData?.zoomLevel ?? 2;

  // Initialize currentCenter from mapCenter for region-aware satellite source detection
  // This effect runs when mapCenter is computed from activities and currentCenter hasn't been set yet
  // Also handles the case when mapCenter changes significantly (e.g., new activities loaded)
  useEffect(() => {
    if (mapCenter !== null) {
      if (currentCenter === null) {
        // First initialization
        setCurrentCenter(mapCenter);
        setCurrentZoom(mapZoom);
      }
    }
  }, [currentCenter, mapCenter, mapZoom]);

  // ANDROID FIX: Compute initial camera settings only once to prevent re-centering on re-renders
  // MapLibre on Android may reapply defaultSettings when props change, causing unwanted camera jumps
  // We track this in a ref so it persists across renders but doesn't cause re-renders
  const initialCameraSettings = useMemo(() => {
    // Already applied - return undefined to prevent re-centering
    if (initialCameraAppliedRef.current) {
      return undefined;
    }
    // Not ready yet - return undefined and wait
    if (!mapCenter) {
      return undefined;
    }
    // First time with valid center - mark as applied and return settings
    initialCameraAppliedRef.current = true;
    return {
      centerCoordinate: mapCenter,
      zoomLevel: mapZoom,
    };
  }, [mapCenter, mapZoom]);

  // Reset camera applied flag when map remounts (iOS retry) so initial position is reapplied
  useEffect(() => {
    if (mapKey > 0) {
      initialCameraAppliedRef.current = false;
    }
  }, [mapKey]);

  return {
    activityCenters,
    mapCenter,
    mapZoom,
    mapBounds,
    currentCenter,
    currentZoom,
    setCurrentCenter,
    setCurrentZoom,
    initialCameraSettings,
  };
}
