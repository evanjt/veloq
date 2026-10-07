import { useMemo } from 'react';
import { decodeCoords } from 'veloqrs';
import { fromUnixSeconds } from '@/shared/ffi/ffiConversions';
import { calculateSpeed } from '@/shared/math';
import type { ActivityMetrics, FfiMapSignature } from 'veloqrs';
import type { Activity, ActivityType, FrequentSection, RoutePoint } from '@/types';

/** Metrics and signatures the screen bundle already read. */
export interface PreComputedSectionActivityData {
  activityMetrics: ActivityMetrics[];
  mapSignatures: FfiMapSignature[];
}

export function useSectionActivityData(
  section: FrequentSection | null,
  sportType: string | undefined,
  bundle: PreComputedSectionActivityData
) {
  // Held as locals so each memo keys on the bundle's own array, not the
  // wrapper literal the screen rebuilds every render.
  const bundledMetrics = bundle.activityMetrics;
  const bundledSignatures = bundle.mapSignatures;

  // Get section activities from engine metrics (no API call needed).
  // Activities are already cached in the Rust engine's in-memory HashMap.
  const sectionActivitiesUnsorted = useMemo(() => {
    if (!section?.activityIds?.length) return [];
    return bundledMetrics.map(
      (m): Activity => ({
        id: m.activityId,
        name: m.name,
        type: m.sportType as ActivityType,
        start_date_local: fromUnixSeconds(m.date)?.toISOString() ?? '',
        distance: m.distance,
        moving_time: m.movingTime,
        elapsed_time: m.elapsedTime,
        total_elevation_gain: m.elevationGain,
        average_speed: calculateSpeed(m.distance, m.movingTime),
        max_speed: 0,
        average_heartrate: m.avgHr ?? undefined,
      })
    );
  }, [section?.activityIds, bundledMetrics]);

  // Load simplified GPS signatures for activity trace display during chart scrubbing
  const allActivityTraces = useMemo((): Record<string, RoutePoint[]> | undefined => {
    if (!section?.activityIds?.length) return undefined;
    try {
      const result: Record<string, RoutePoint[]> = {};
      for (const sig of bundledSignatures) {
        const decoded = decodeCoords(sig.encodedCoords);
        if (decoded.length < 2) continue;
        const points: RoutePoint[] = decoded.map((p) => ({ lat: p.latitude, lng: p.longitude }));
        result[sig.activityId] = points;
      }
      return Object.keys(result).length > 0 ? result : undefined;
    } catch {
      // empty-on-error: decodes signatures the screen bundle already carries, no engine read;
      // without traces the scrub draws no activity overlay and every figure is unaffected.
      return undefined;
    }
  }, [section?.activityIds, bundledSignatures]);

  // The activities of the sport on screen. The sport comes from the engine's
  // screen read, which counts the pills and picks the default.
  const filteredActivities = useMemo(() => {
    if (!sportType) return sectionActivitiesUnsorted;
    return sectionActivitiesUnsorted.filter((a) => a.type === sportType);
  }, [sectionActivitiesUnsorted, sportType]);

  return {
    sectionActivitiesUnsorted,
    allActivityTraces,
    filteredActivities,
  };
}
