import { useMemo } from 'react';
import type { DayLoad } from 'veloqrs';

import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { formatLocalDate } from '@/shared/format/format';
import { dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';

const NO_LOADS: DayLoad[] = [];

/**
 * Recorded activity load per local day over the last `days` days, read from
 * the engine once per window and again when a sync announces new activities.
 * A scrub reads this array and calls nothing.
 */
export function useDailyActivityLoads(days: number, enabled = true): DayLoad[] {
  const read = useEngineRead(['activities']);

  return useMemo(() => {
    if (!enabled) return NO_LOADS;
    const today = new Date();
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - days);
    try {
      return (
        read((engine) =>
          engine.getDailyActivityLoads(
            dayStartEpochSeconds(formatLocalDate(windowStart)),
            dayEndEpochSeconds(formatLocalDate(today))
          )
        ) ?? NO_LOADS
      );
    } catch {
      return NO_LOADS;
    }
  }, [read, days, enabled]);
}
