import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { fromUnixSeconds } from '@/shared/ffi/ffiConversions';
import type { PerformanceDataPoint } from '../types';

export function useExcludedActivities(id: string | undefined, sportFilter: string | undefined) {
  // Excluded activities state
  const [showExcluded, setShowExcluded] = useState(false);
  const [excludedActivityIds, setExcludedActivityIds] = useState<Set<string>>(new Set());

  // Load excluded activity IDs for this route
  useEffect(() => {
    if (!id) return;
    const engine = getRouteEngine();
    if (!engine) return;
    const ids = engine.getExcludedRouteActivityIds(id);
    setExcludedActivityIds(new Set(ids));
  }, [id]);

  const handleExcludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getRouteEngine();
      if (!engine) return;
      engine.excludeActivityFromRoute(id, activityId);
      setExcludedActivityIds((prev) => new Set([...prev, activityId]));
    },
    [id]
  );

  const handleIncludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getRouteEngine();
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
  const excludedChartData = useMemo((): (PerformanceDataPoint & { x: number })[] => {
    if (!showExcluded || excludedActivityIds.size === 0 || !id) return [];
    try {
      const engine = getRouteEngine();
      if (!engine) return [];
      const result = engine.getExcludedRoutePerformances(id, sportFilter);
      if (!result?.performances?.length) return [];

      return result.performances
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
        }));
    } catch (e) {
      if (__DEV__) console.warn('[RouteDetail] getExcludedRoutePerformances failed:', e);
      return [];
    }
  }, [showExcluded, excludedActivityIds, id, sportFilter]);

  return {
    showExcluded,
    excludedActivityIds,
    handleExcludeActivity,
    handleIncludeActivity,
    handleToggleShowExcluded,
    excludedChartData,
  };
}
