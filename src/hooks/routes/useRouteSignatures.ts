import { useState, useEffect, useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { getRouteEngine } from '@/lib/native/routeEngine';

export interface RouteSignature {
  points: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
}

/**
 * Hook to get route signatures from the Rust engine.
 *
 * Uses a single batch FFI call (getAllMapSignatures) to fetch simplified signatures
 * (~100 points each via Douglas-Peucker) instead of individual getGpsTrack() calls
 * (~5,000 points each). This reduces memory from ~250MB to ~5MB for 1,000 activities.
 *
 * PERFORMANCE: Defers loading until after animations complete to avoid blocking UI.
 *
 * @param enabled - Whether to load signatures (default: true). Set to false when the
 *   map tab is not focused to release memory.
 * @returns Record mapping activityId to {points, center}
 */
export function useRouteSignatures(enabled = true): Record<string, RouteSignature> {
  const [signatures, setSignatures] = useState<Record<string, RouteSignature>>({});
  const isMountedRef = useRef(true);

  const buildSignatures = useCallback(() => {
    if (!enabled) return;
    const engine = getRouteEngine();
    if (!engine || !isMountedRef.current) return;

    try {
      // Single FFI call returns all simplified signatures (~100 pts each)
      const mapSignatures = engine.getAllMapSignatures();
      const sigs: Record<string, RouteSignature> = {};

      for (const sig of mapSignatures) {
        if (sig.coords.length < 4) continue; // Need at least 2 points

        // Convert flat [lat, lng, lat, lng, ...] to point objects
        const points: Array<{ lat: number; lng: number }> = [];
        for (let i = 0; i < sig.coords.length - 1; i += 2) {
          points.push({ lat: sig.coords[i], lng: sig.coords[i + 1] });
        }

        sigs[sig.activityId] = {
          points,
          center: { lat: sig.centerLat, lng: sig.centerLng },
        };
      }

      if (isMountedRef.current) {
        setSignatures(sigs);
      }
    } catch {
      if (isMountedRef.current) {
        setSignatures({});
      }
    }
  }, [enabled]);

  // Clear signatures when disabled (releases memory on tab switch)
  useEffect(() => {
    if (!enabled) {
      setSignatures({});
    }
  }, [enabled]);

  useEffect(() => {
    isMountedRef.current = true;
    const engine = getRouteEngine();
    if (!engine || !enabled) return;

    // Defer loading until after navigation animations complete
    const task = InteractionManager.runAfterInteractions(() => {
      buildSignatures();
    });

    // Subscribe to activity changes
    const unsubscribe = engine.subscribe('activities', buildSignatures);

    return () => {
      isMountedRef.current = false;
      task.cancel();
      unsubscribe();
    };
  }, [buildSignatures, enabled]);

  return signatures;
}
