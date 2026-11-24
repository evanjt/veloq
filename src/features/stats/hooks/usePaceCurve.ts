import { fitness, sync } from 'veloqrs';
import { paceCurveOf } from '@/features/stats/lib/curveRecords';
import { queryKeys } from '@/shared/query/queryKeys';
import type { PaceCurve } from '@/types';
import { useStoredCurve } from './useStoredCurve';

interface UsePaceCurveOptions {
  sport?: string;
  /** Number of days to include (default 42 to match intervals.icu) */
  days?: number;
  /** Use gradient adjusted pace (running only) */
  gap?: boolean;
  enabled?: boolean;
}

export function usePaceCurve(options: UsePaceCurveOptions = {}) {
  const { sport = 'Run', days = 42, gap = false, enabled = true } = options;
  return useStoredCurve<PaceCurve>({
    queryKey: queryKeys.charts.paceCurve.bySport(sport, days, gap),
    read: () => {
      const stored = fitness.getPaceCurve(sport, days, gap);
      return stored ? { curve: paceCurveOf(stored), fetchedAt: stored.fetchedAt } : null;
    },
    sync: () => sync.syncPaceCurve(sport, days, gap),
    bodyName: 'pace_curve',
    empty: { type: 'pace', sport, distances: [], times: [], pace: [] },
    days,
    enabled,
  });
}
