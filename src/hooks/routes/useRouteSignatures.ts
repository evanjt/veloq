import { useState, useEffect, useCallback } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { gpsPointsToRoutePoints } from 'route-matcher-native';

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
 * NOTE: getAllSignatures is not directly available in the new API.
 * This hook now builds signatures from GPS tracks on demand.
 *
 * @returns Record mapping activityId to {points, center}
 */
export function useRouteSignatures(): Record<string, RouteSignature> {
  const [signatures, setSignatures] = useState<Record<string, RouteSignature>>({});

  const buildSignatures = useCallback(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    try {
      const activityIds = engine.getActivityIds();
      const sigs: Record<string, RouteSignature> = {};

      for (const activityId of activityIds) {
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

      setSignatures(sigs);
    } catch {
      setSignatures({});
    }
  }, []);

  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    // Initial load
    buildSignatures();

    // Subscribe to activity changes
    const unsubscribe = engine.subscribe('activities', buildSignatures);

    return unsubscribe;
  }, [buildSignatures]);

  return signatures;
}
