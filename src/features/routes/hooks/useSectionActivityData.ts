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
  selectedSportType: string | undefined,
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
      return undefined;
    }
  }, [section?.activityIds, bundledSignatures]);

  // Compute available sport types with activity counts for cross-sport sections.
  // Derived from the metrics already fetched for sectionActivitiesUnsorted to
  // avoid a second getActivityMetricsForIds round-trip.
  const sportTypeCounts = useMemo(() => {
    if (!section?.activityIds?.length) return [];
    const counts = new Map<string, number>();
    for (const a of sectionActivitiesUnsorted) {
      if (a.type) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    }
    if (counts.size === 0) {
      return [{ type: section.sportType, count: section.activityIds?.length ?? 0 }];
    }
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [section?.sportType, section?.activityIds, sectionActivitiesUnsorted]);

  const availableSportTypes = useMemo(() => sportTypeCounts.map((s) => s.type), [sportTypeCounts]);

  // Effective sport type: matches the visually-selected pill.
  // When selectedSportType is undefined (initial state), default to section's own sport type
  // so the chart data matches the highlighted pill.
  const effectiveSportType = useMemo(() => {
    if (selectedSportType) return selectedSportType;
    if (availableSportTypes.length > 1 && section?.sportType) return section.sportType;
    return undefined;
  }, [selectedSportType, availableSportTypes.length, section?.sportType]);

  // Filter activities by selected sport type for chart data
  const filteredActivities = useMemo(() => {
    if (!effectiveSportType) return sectionActivitiesUnsorted;
    return sectionActivitiesUnsorted.filter((a) => a.type === effectiveSportType);
  }, [sectionActivitiesUnsorted, effectiveSportType]);

  return {
    sectionActivitiesUnsorted,
    allActivityTraces,
    sportTypeCounts,
    availableSportTypes,
    effectiveSportType,
    filteredActivities,
  };
}
