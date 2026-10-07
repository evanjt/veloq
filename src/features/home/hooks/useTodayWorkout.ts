import { useQuery } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { formatLocalDate } from '@/shared/format/format';
import { CACHE } from '@/shared/app/constants';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { readCalendarEvents } from '@/features/home/lib/calendarEvents';
import { queryKeys } from '@/shared/query/queryKeys';
import type { CalendarEvent } from '@/types';

/**
 * Read the planned workouts ahead from the engine's stored calendar window.
 * The banner draws today and tomorrow from the forward fortnight the sync owns.
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

  useEngineChannel('bodyStored', queryKey, 'calendar');

  const query = useQuery<CalendarEvent[]>({
    ...LOCAL_READ_QUERY,
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
