import { useMemo } from 'react';
import type { EfficiencyTrend } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from './useEngine';

/**
 * Aerobic efficiency over the matched efforts on one section.
 *
 * The engine regresses HR/pace across efforts that carry both signals, so a
 * section with one such effort has a trend but no series. A single point
 * plots nothing, so it is dropped here rather than in every consumer.
 *
 * `bundledTrend` lets a caller that already read it as part of a screen bundle
 * skip this hook's own FFI call. `null` is an answer, so only `undefined`
 * falls back to reading.
 */
export function useSectionEfficiencyTrend(
  sectionId: string | null,
  bundledTrend?: EfficiencyTrend | null
): EfficiencyTrend | null {
  const trigger = useEngineSubscription(['sections']);

  return useMemo(() => {
    if (bundledTrend !== undefined) {
      return bundledTrend && bundledTrend.points.length >= 2 ? bundledTrend : null;
    }
    if (!sectionId) return null;

    const engine = getEngine();
    if (!engine) return null;

    try {
      const trend = engine.getSectionEfficiencyTrend(sectionId);
      if (!trend || trend.points.length < 2) return null;
      return trend;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, trigger, bundledTrend]);
}
