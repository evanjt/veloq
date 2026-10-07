/**
 * Read stored calendar events over a date window.
 *
 * The Rust sync replaces a whole window rather than upserting into it, so an
 * event cancelled on intervals.icu disappears here too.
 */
import { getEngine } from '@/shared/native/engine';
import { dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';
import type { CalendarEvent } from '@/types';

/**
 * The engine stamps each event's `start_date_local` as wall clock read as UTC,
 * so the window is built the same way. Local midnight as a true instant slides
 * it by the device offset.
 */
export function readCalendarEvents(oldest: string, newest: string): CalendarEvent[] {
  const engine = getEngine();
  if (!engine?.getCalendarEventBodies) return [];

  const out: CalendarEvent[] = [];
  for (const body of engine.getCalendarEventBodies(
    dayStartEpochSeconds(oldest),
    dayEndEpochSeconds(newest)
  )) {
    try {
      out.push(JSON.parse(body) as CalendarEvent);
    } catch {
      // A body we cannot parse is a corrupt row, not an empty day.
    }
  }
  return out;
}
