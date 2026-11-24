import { useMemo } from 'react';
import type { DayLoad } from 'veloqrs';

import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { formatLocalDate, addLocalDays } from '@/shared/time/localDay';
import { dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';

const NO_LOADS: DayLoad[] = [];

/**
 * Recorded activity load per local day over the last `days` days, read from
 * the engine once per window and again when a sync announces new activities.
 * A scrub reads this array and calls nothing.
 */
export function useDailyActivityLoads(days: number, enabled = true): DayLoad[] {
  // The window is measured back from today, so a new local day is a new read.
  const day = formatLocalDate(new Date());
  const read = useEngineRead(['activities'], [day]);

  return useMemo(() => {
    if (!enabled) return NO_LOADS;
    const today = new Date();
    const windowStart = addLocalDays(today, -days);
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
      // empty-on-error: a chart window with no loads draws flat, and the next sync invalidates the read
      return NO_LOADS;
    }
  }, [read, days, enabled]);
}
