import { useMemo } from 'react';

import { currentAndPreviousWeek } from '@/features/fitness/lib/weekWindow';
import { formatLocalDate } from '@/shared/format/format';
import { useEngineRead } from '@/shared/native/useEngineSubscription';

/**
 * The last critical speed stored for a sport, in m/s, or null when the app has
 * never held one.
 *
 * `pace_history` is written every time a pace curve is fetched, and the engine's
 * trend over it crosses the FFI only inside the summary card bundle. That
 * bundle's week window belongs to its totals, which are discarded here, so the
 * window is this week and nothing turns on it.
 */
export function useStoredPaceTrend(sport: 'Run' | 'Swim'): number | null {
  const readPaceTrend = useEngineRead(['activities']);
  // The window moves once a day, not once a render.
  const todayKey = formatLocalDate(new Date());

  return useMemo(() => {
    const latest = readPaceTrend((engine) => {
      if (!engine.getSummaryCardData) return null;

      // Built from the day key rather than from a second clock read, so a
      // render that straddles midnight cannot ask for one day's window under
      // the other day's key.
      const { weekStartTs, weekEndTs, prevStartTs, prevEndTs } = currentAndPreviousWeek(
        localDay(todayKey)
      );
      try {
        const card = engine.getSummaryCardData(weekStartTs, weekEndTs, prevStartTs, prevEndTs);
        const trend = sport === 'Run' ? card?.runPaceTrend : card?.swimPaceTrend;
        return trend?.latestPace ?? null;
      } catch {
        // A fallback reading is not worth a failed screen.
        return null;
      }
    });
    return latest ?? null;
  }, [sport, readPaceTrend, todayKey]);
}

/** `YYYY-MM-DD` as local midnight, which is the calendar day the key names. */
function localDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}
