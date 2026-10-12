/**
 * The stored activity bodies over a date window, parsed. It sits in `shared`
 * because the feed and the demo route sync both read it, and the barrel that
 * would otherwise carry it closes a cycle.
 */

import { timeAppWork } from '@/shared/debug/renderTimer';
import { getEngine } from '@/shared/native/engine';
import { dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';
import type { Activity } from '@/types';

/**
 * Read stored activities over a date window, newest first. A body that will
 * not parse is dropped rather than surfaced as a half-populated card.
 */
export function readActivities(oldest: string, newest: string): Activity[] {
  const engine = getEngine();
  if (!engine?.getActivityBodies) return [];
  return parseBodies(
    engine.getActivityBodies(dayStartEpochSeconds(oldest), dayEndEpochSeconds(newest))
  );
}

/** The metrics row for parsing a window of stored activity bodies. */
export const DECODE_ACTIVITY_BODIES = 'decode.activityBodies';

export function parseBodies(bodies: readonly string[]): Activity[] {
  return timeAppWork(DECODE_ACTIVITY_BODIES, () => {
    const out: Activity[] = [];
    for (const body of bodies) {
      try {
        out.push(JSON.parse(body) as Activity);
      } catch {
        // A body we cannot parse is a corrupt row, not an activity with no data.
      }
    }
    return out;
  });
}
