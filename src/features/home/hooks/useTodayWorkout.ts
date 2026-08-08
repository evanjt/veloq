import { useQuery } from '@tanstack/react-query';
import { formatLocalDate } from '@/shared/format/format';
import { CACHE } from '@/shared/app/constants';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineBody } from '@/shared/native/engineBodies';
import { readCalendarEvents } from '@/features/home/lib/calendarEvents';
import { queryKeys } from '@/shared/query/queryKeys';
import type { CalendarEvent } from '@/types';

/**
 * Fetch today's and tomorrow's planned workouts from the intervals.icu calendar.
 * Uses CALENDAR:READ scope (already authorized).
 *
 * Calendar events are relatively static - 5min staleTime prevents over-fetching
 * while still reflecting changes if the user edits their plan on intervals.icu.
 */
export function useTodayWorkout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const today = formatLocalDate(new Date());
  // Calendar arithmetic, not 24 hours. A spring-forward day is 23 hours long,
  // so adding a fixed day skips a date in the hour before midnight.
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = formatLocalDate(tomorrowDate);

  const queryKey = queryKeys.calendar.events(today);

  // A planned workout can be added or cancelled upstream at any time, so the
  // window is re-requested on every mount rather than only when empty.
  useEngineBody(
    false,
    () => getRouteEngine()?.syncCalendarEvents(today, tomorrow),
    queryKey,
    isAuthenticated
  );

  const query = useQuery<CalendarEvent[]>({
    queryKey,
    queryFn: () => readCalendarEvents(today, tomorrow).filter((e) => e.category === 'WORKOUT'),
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
