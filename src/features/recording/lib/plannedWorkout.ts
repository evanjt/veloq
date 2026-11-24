import { readPlannedWorkouts } from '@/features/home';
import { formatLocalDate } from '@/shared/time/localDay';
import { followablePlan, type PlanLine } from './planFollow';

/**
 * Today's planned workout for an event, read once from the engine's stored
 * calendar. The caller freezes what it gets: a refresh that lands mid-session,
 * or midnight passing, must not move the plan under the athlete.
 */
export function readPlannedWorkout(eventId: number): { name: string; lines: PlanLine[] } | null {
  const today = formatLocalDate(new Date());
  return followablePlan(readPlannedWorkouts(today, today), eventId);
}
