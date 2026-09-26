import { useQuery } from '@tanstack/react-query';
import { formatLocalDate } from '@/shared/format/format';
import { CACHE } from '@/shared/app/constants';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { useEngineBody } from '@/shared/native/engineBodies';
import { readCalendarEvents } from '@/features/home/lib/calendarEvents';
import { queryKeys } from '@/shared/query/queryKeys';
import type { CalendarEvent } from '@/types';

/**
 * Fetch the planned workouts ahead from the intervals.icu calendar.
 * Uses CALENDAR:READ scope (already authorized).
 *
 * Calendar events are relatively static - 5min staleTime prevents over-fetching
 * while still reflecting changes if the user edits their plan on intervals.icu.
 *
 * The banner draws today and tomorrow, but the window fetched is a fortnight.
 * `replace_calendar_events` clears the window before it writes, so a day that
 * was never fetched while online is not backfilled by a later, wider request:
 * a two-day window emptied the banner on the second day offline.
 */
const WINDOW_DAYS = 14;

export function useTodayWorkout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Calendar arithmetic, not 24 hours. A spring-forward day is 23 hours long,
  // so adding a fixed day skips a date in the hour before midnight.
  const dayFromNow = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return formatLocalDate(date);
  };

  const today = formatLocalDate(new Date());
  const tomorrow = dayFromNow(1);
  const horizon = dayFromNow(WINDOW_DAYS);

  const queryKey = queryKeys.calendar.events(today);

  // A planned workout can be added or cancelled upstream at any time, so the
  // window is re-requested on every mount rather than only when empty.
  useEngineBody(
    false,
    () => getEngine()?.syncCalendarEvents(today, horizon),
    queryKey,
    isAuthenticated
  );

  const query = useQuery<CalendarEvent[]>({
    queryKey,
    queryFn: () => readCalendarEvents(today, horizon).filter((e) => e.category === 'WORKOUT'),
    enabled: isAuthenticated,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: CACHE.HOUR, // 1 hour
  });

  const todayWorkout = query.data?.find((e) => e.start_date_local?.startsWith(today)) ?? null;
  const tomorrowWorkout = query.data?.find((e) => e.start_date_local?.startsWith(tomorrow)) ?? null;

  return {
    todayWorkout,
    tomorrowWorkout,
    isLoading: query.isLoading,
  };
}
