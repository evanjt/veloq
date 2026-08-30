import { useMemo } from 'react';
import type { EfficiencyTrend } from 'veloqrs';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineSubscription } from './useRouteEngine';

/**
 * Aerobic efficiency over the matched efforts on one section.
 *
 * The engine regresses HR/pace across efforts that carry both signals, so a
 * section with one such effort has a trend but no series. A single point
 * plots nothing, so it is dropped here rather than in every consumer.
 */
export function useSectionEfficiencyTrend(sectionId: string | null): EfficiencyTrend | null {
  const trigger = useEngineSubscription(['sections']);

  return useMemo(() => {
    if (!sectionId) return null;

    const engine = getRouteEngine();
    if (!engine) return null;

    try {
      const trend = engine.getSectionEfficiencyTrend(sectionId);
      if (!trend || trend.points.length < 2) return null;
      return trend;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, trigger]);
}
