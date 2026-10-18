/**
 * Read stored calendar events over a date window.
 *
 * The Rust sync replaces a whole window rather than upserting into it, so an
 * event cancelled on intervals.icu disappears here too.
 */
import { FfiPlannedCategory, type FfiPlannedEvent } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';

/**
 * The engine stamps each event's `start_date_local` as wall clock read as UTC,
 * so the window is built the same way. Local midnight as a true instant slides
 * it by the device offset.
 */
export function readCalendarEvents(oldest: string, newest: string): FfiPlannedEvent[] {
  const engine = getEngine();
  if (!engine?.getPlannedEvents) return [];
  return engine.getPlannedEvents(dayStartEpochSeconds(oldest), dayEndEpochSeconds(newest));
}

/**
 * The planned workouts over a date window. The calendar also holds notes,
 * targets, races and seasons, and none of those is a workout to follow.
 */
export function readPlannedWorkouts(oldest: string, newest: string): FfiPlannedEvent[] {
  return readCalendarEvents(oldest, newest).filter(
    (e) => e.category === FfiPlannedCategory.Workout
  );
}
