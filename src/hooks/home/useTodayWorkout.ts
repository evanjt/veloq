import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { formatLocalDate } from '@/lib';
import { useAuthStore } from '@/providers/AuthStore';
import type { CalendarEvent } from '@/types';

/**
 * Fetch today's and tomorrow's planned workouts from the intervals.icu calendar.
 * Uses CALENDAR:READ scope (already authorized).
 *
 * Calendar events are relatively static — 5min staleTime prevents over-fetching
 * while still reflecting changes if the user edits their plan on intervals.icu.
 */
export function useTodayWorkout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const today = formatLocalDate(new Date());
  const tomorrow = formatLocalDate(new Date(Date.now() + 86400000));

  const query = useQuery<CalendarEvent[]>({
    queryKey: ['calendar-events', today],
    queryFn: () =>
      intervalsApi.getCalendarEvents({
        oldest: today,
        newest: tomorrow,
        category: 'WORKOUT',
      }),
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 min — planned workouts don't change often
    gcTime: 1000 * 60 * 60, // 1 hour
  });

  const todayWorkout = query.data?.find((e) => e.start_date_local?.startsWith(today)) ?? null;
  const tomorrowWorkout = query.data?.find((e) => e.start_date_local?.startsWith(tomorrow)) ?? null;

  return {
    todayWorkout,
    tomorrowWorkout,
    isLoading: query.isLoading,
  };
}
