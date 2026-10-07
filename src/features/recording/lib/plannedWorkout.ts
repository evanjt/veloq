import { readCalendarEvents } from '@/features/home';
import { formatLocalDate } from '@/shared/format/format';
import { followablePlan, type PlanLine } from './planFollow';

/**
 * Today's planned workout for an event, read once from the engine's stored
 * calendar. The caller freezes what it gets: a refresh that lands mid-session,
 * or midnight passing, must not move the plan under the athlete.
 */
export function readPlannedWorkout(eventId: number): { name: string; lines: PlanLine[] } | null {
  const today = formatLocalDate(new Date());
  return followablePlan(readCalendarEvents(today, today), eventId);
}
