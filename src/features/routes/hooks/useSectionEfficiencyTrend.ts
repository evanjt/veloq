import { useMemo } from 'react';
import type { EfficiencyTrend } from 'veloqrs';
import { useEngineRead } from '@/shared/native/useEngineSubscription';

interface UseSectionEfficiencyTrendResult {
  trend: EfficiencyTrend | null;
  /** What the engine threw, when the read failed. A null trend with no error is no series. */
  error?: unknown;
}

/**
 * Aerobic efficiency over the matched efforts on one section.
 *
 * The engine regresses heart rate per unit of speed across efforts that carry both signals, so a
 * section with one such effort has a trend but no series. A single point
 * plots nothing, so it is dropped here rather than in every consumer.
 *
 * The trend is one sport's efforts, so `sportType` names the sport on screen.
 * `bundledTrend` lets a caller that already read it as part of a screen bundle
 * skip this hook's own FFI call when it answered for that sport. `null` is an
 * answer, so only `undefined`, or a trend for another sport, falls back to
 * reading.
 */
export function useSectionEfficiencyTrend(
  sectionId: string | null,
  sportType: string | null | undefined,
  bundledTrend?: EfficiencyTrend | null
): UseSectionEfficiencyTrendResult {
  const readSections = useEngineRead(['sections']);

  return useMemo(() => {
    if (bundledTrend !== undefined && (!bundledTrend || bundledTrend.sportType === sportType)) {
      return { trend: bundledTrend && bundledTrend.points.length >= 2 ? bundledTrend : null };
    }
    if (!sectionId || !sportType) return { trend: null };

    try {
      const trend = readSections((engine) =>
        engine.getSectionEfficiencyTrend(sectionId, sportType)
      );
      if (!trend || trend.points.length < 2) return { trend: null };
      return { trend };
    } catch (error) {
      return { trend: null, error };
    }
  }, [sectionId, sportType, readSections, bundledTrend]);
}
