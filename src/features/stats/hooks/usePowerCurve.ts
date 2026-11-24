import { fitness, sync } from 'veloqrs';
import { powerCurveOf } from '@/features/stats/lib/curveRecords';
import { queryKeys } from '@/shared/query/queryKeys';
import type { PowerCurve } from '@/types';
import { useStoredCurve } from './useStoredCurve';

interface UsePowerCurveOptions {
  sport?: string | undefined;
  /** Number of days to include (default 365) */
  days?: number | undefined;
  enabled?: boolean | undefined;
}

export function usePowerCurve(options: UsePowerCurveOptions = {}) {
  const { sport = 'Ride', days = 365, enabled = true } = options;
  return useStoredCurve<PowerCurve>({
    queryKey: queryKeys.charts.powerCurve.bySport(sport, days),
    read: () => {
      const stored = fitness.getPowerCurve(sport, days);
      return stored ? { curve: powerCurveOf(stored), fetchedAt: stored.fetchedAt } : null;
    },
    sync: () => sync.syncPowerCurve(sport, days),
    bodyName: 'power_curve',
    empty: { type: 'power', sport, secs: [], watts: [] },
    days,
    enabled,
  });
}
