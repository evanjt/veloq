import { useMemo } from 'react';
import { decodeCoords, maps } from 'veloqrs';
import type { RouteGroup as EngineRouteGroup, FfiMapSignature } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import type { LatLngShort } from '@/shared/geo/distance';

/**
 * Each attempt's simplified track, keyed by activity, for the route map's
 * traces and the attempt the chart highlights.
 */
export function useRouteMapSignatures(
  engineGroup: EngineRouteGroup | null | undefined,
  preComputedSignatures?: FfiMapSignature[]
): Record<string, { points: LatLngShort[] }> {
  return useMemo(() => {
    if (!engineGroup?.activityIds?.length) return {};
    try {
      let allSigs = preComputedSignatures;
      if (!allSigs) {
        const engine = getEngine();
        if (!engine) return {};
        allSigs = maps.getAllMapSignatures();
      }

      const activityIdSet = new Set(engineGroup.activityIds);
      const result: Record<string, { points: LatLngShort[] }> = {};

      for (const sig of allSigs) {
        if (!activityIdSet.has(sig.activityId)) continue;
        const decoded = decodeCoords(sig.encodedCoords);
        if (decoded.length < 2) continue;
        const points = decoded.map((p) => ({ lat: p.latitude, lng: p.longitude }));
        result[sig.activityId] = { points };
      }
      return result;
    } catch {
      // empty-on-error: the map draws the route without per-attempt traces; the chart's points come from the performance read.
      return {};
    }
  }, [engineGroup, preComputedSignatures]);
}
