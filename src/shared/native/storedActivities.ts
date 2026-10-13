/**
 * The stored activity bodies over a date window, parsed. It sits in `shared`
 * because the feed and the demo route sync both read it, and the barrel that
 * would otherwise carry it closes a cycle.
 */

import { timeAppWork } from '@/shared/debug/renderTimer';
import { getEngine } from '@/shared/native/engine';
import { dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';
import type { ActivityBodiesPage } from 'veloqrs';
import type { Activity } from '@/types';

/**
 * Read stored activities over a date window, newest first. A body that will
 * not parse is dropped rather than surfaced as a half-populated card.
 */
export function readActivities(oldest: string, newest: string): Activity[] {
  const engine = getEngine();
  if (!engine?.getActivityBodies) return [];
  const page = engine.getActivityBodies(dayStartEpochSeconds(oldest), dayEndEpochSeconds(newest));
  return page ? parseBodies(page) : [];
}

/** The metrics row for parsing a window of stored activity bodies. */
export const DECODE_ACTIVITY_BODIES = 'decode.activityBodies';

/**
 * Each body of a page as an activity, carrying the id a web link may name that
 * the engine answered beside it.
 */
export function parseBodies(page: Pick<ActivityBodiesPage, 'bodies' | 'intervalsIds'>): Activity[] {
  return timeAppWork(DECODE_ACTIVITY_BODIES, () => {
    const out: Activity[] = [];
    page.bodies.forEach((body, index) => {
      try {
        const activity = JSON.parse(body) as Activity;
        activity.intervalsWebId = page.intervalsIds[index] ?? null;
        out.push(activity);
      } catch {
        // A body we cannot parse is a corrupt row, not an activity with no data.
      }
    });
    return out;
  });
}
