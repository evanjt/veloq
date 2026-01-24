import { useState, useEffect, useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { gpsPointsToRoutePoints } from 'veloqrs';

export interface RouteSignature {
  points: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
}

/**
 * Hook to get route signatures from the Rust engine.
 *
 * Signatures contain simplified GPS traces for rendering activity paths on maps.
 * The hook subscribes to engine activity changes and updates automatically.
 *
 * PERFORMANCE: Defers loading until after animations complete to avoid blocking UI.
 * Processes activities in batches to keep the main thread responsive.
 *
 * @returns Record mapping activityId to {points, center}
 */
export function useRouteSignatures(): Record<string, RouteSignature> {
  const [signatures, setSignatures] = useState<Record<string, RouteSignature>>({});
  const isMountedRef = useRef(true);

  const buildSignatures = useCallback(() => {
    const engine = getRouteEngine();
    if (!engine || !isMountedRef.current) return;

    try {
      const activityIds = engine.getActivityIds();
      const sigs: Record<string, RouteSignature> = {};

      // Process in batches to avoid blocking main thread
      const BATCH_SIZE = 20;
      let processed = 0;

      const processBatch = () => {
        if (!isMountedRef.current) return;

        const end = Math.min(processed + BATCH_SIZE, activityIds.length);
        for (let i = processed; i < end; i++) {
          const activityId = activityIds[i];
          const track = engine.getGpsTrack(activityId);
          if (track.length < 2) continue;

          // Convert GpsPoint[] to RoutePoint format
          const points = gpsPointsToRoutePoints(track);

          // Calculate center
          let sumLat = 0;
          let sumLng = 0;
          for (const p of points) {
            sumLat += p.lat;
            sumLng += p.lng;
          }

          sigs[activityId] = {
            points,
            center: {
              lat: sumLat / points.length,
              lng: sumLng / points.length,
            },
          };
        }
        processed = end;

        if (processed < activityIds.length) {
          // Process next batch after a short delay to let UI breathe
          setTimeout(processBatch, 0);
        } else {
          // All done
          if (isMountedRef.current) {
            setSignatures(sigs);
          }
        }
      };

      processBatch();
    } catch {
      if (isMountedRef.current) {
        setSignatures({});
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const engine = getRouteEngine();
    if (!engine) return;

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
  }, [buildSignatures]);

  return signatures;
}
