/**
 * Read stored calendar events over a date window.
 *
 * The Rust sync replaces a whole window rather than upserting into it, so an
 * event cancelled on intervals.icu disappears here too.
 */
import { getEngine } from '@/shared/native/engine';
import type { CalendarEvent } from '@/types';

/** Local midnight for a YYYY-MM-DD day, as the epoch seconds the engine keys on. */
function dayStartTimestamp(day: string): number {
  return Math.floor(new Date(`${day}T00:00:00`).getTime() / 1000);
}

export function readCalendarEvents(oldest: string, newest: string): CalendarEvent[] {
  const engine = getEngine();
  if (!engine?.getCalendarEventBodies) return [];

  const out: CalendarEvent[] = [];
  for (const body of engine.getCalendarEventBodies(
    dayStartTimestamp(oldest),
    dayStartTimestamp(newest) + 86399
  )) {
    try {
      out.push(JSON.parse(body) as CalendarEvent);
    } catch {
      // A body we cannot parse is a corrupt row, not an empty day.
    }
  }
  return out;
}
