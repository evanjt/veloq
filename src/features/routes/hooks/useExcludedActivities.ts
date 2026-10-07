import { useCallback, useEffect, useMemo, useState } from 'react';
import { getEngine } from '@/shared/native/engine';
import { attemptEngineRead } from '@/shared/native/engineError';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { fromUnixSeconds } from '@/shared/ffi/ffiConversions';
import type { PerformanceDataPoint } from '../types';

/**
 * `preComputedExcludedIds` lets a caller that already read the exclusions as
 * part of a screen bundle skip this hook's own FFI call.
 */
export function useExcludedActivities(
  id: string | undefined,
  sportFilter: string | undefined,
  preComputedExcludedIds?: string[]
) {
  // A rematch or a sync changes which attempts are excluded and what the
  // excluded ones read, and neither moves the keys below. The reader is that
  // announcement: the memo calls it, so the dependency is one both gates read
  // the same way.
  const readSections = useEngineRead(['sections', 'detectionApplied']);

  // Excluded activities state
  const [showExcluded, setShowExcluded] = useState(false);
  const [excludedActivityIds, setExcludedActivityIds] = useState<Set<string>>(new Set());

  // Load excluded activity IDs for this route
  useEffect(() => {
    if (!id) return;
    if (preComputedExcludedIds) {
      setExcludedActivityIds(new Set(preComputedExcludedIds));
      return;
    }
    const engine = getEngine();
    if (!engine) return;
    const ids = engine.getExcludedRouteActivityIds(id);
    setExcludedActivityIds(new Set(ids));
  }, [id, preComputedExcludedIds]);

  const handleExcludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getEngine();
      if (!engine) return;
      engine.excludeActivityFromRoute(id, activityId);
      setExcludedActivityIds((prev) => new Set([...prev, activityId]));
    },
    [id]
  );

  const handleIncludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getEngine();
      if (!engine) return;
      engine.includeActivityInRoute(id, activityId);
      setExcludedActivityIds((prev) => {
        const next = new Set(prev);
        next.delete(activityId);
        return next;
      });
    },
    [id]
  );

  const handleToggleShowExcluded = useCallback(() => {
    setShowExcluded((v) => !v);
  }, []);

  // Build chart data points for excluded activities
  const excluded = useMemo((): {
    points: (PerformanceDataPoint & { x: number })[];
    error: unknown;
  } => {
    if (!showExcluded || excludedActivityIds.size === 0 || !id) {
      return { points: [], error: undefined };
    }
    const read = attemptEngineRead(() =>
      readSections((engine) => engine.getExcludedRoutePerformances(id, sportFilter))
    );
    if (!read.ok) return { points: [], error: read.error };
    const result = read.value;
    if (!result?.performances?.length) return { points: [], error: undefined };

    const points = result.performances
      .filter((p) => Number.isFinite(p.speed))
      .map((p) => ({
        x: 0,
        id: p.activityId,
        activityId: p.activityId,
        speed: p.speed,
        date: fromUnixSeconds(p.date) ?? new Date(),
        activityName: p.name,
        direction: (p.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
        sectionTime: Math.round(p.duration),
        matchPercentage: p.matchPercentage,
        isExcluded: true,
        outsideDistanceBand: p.outsideDistanceBand,
      }));
    return { points, error: undefined };
  }, [showExcluded, excludedActivityIds, id, sportFilter, readSections]);

  return {
    showExcluded,
    excludedActivityIds,
    handleExcludeActivity,
    handleIncludeActivity,
    handleToggleShowExcluded,
    excludedChartData: excluded.points,
    /** What the excluded performances read threw, when it threw. */
    excludedReadError: excluded.error,
  };
}
