import { getEngine } from '@/shared/native/engine';
import type { Activity } from '@/types';

/**
 * The stored body for one activity.
 *
 * `activity_bodies` is keyed by `activity_id`, so this is a primary-key read.
 * It is named for the one activity rather than for the window that contains
 * its day: the window read returns every body in range and leaves the caller
 * parsing all of them to find one, which on a 490-activity library is 490
 * `JSON.parse` calls on the JS thread, repeated on every sync event that
 * invalidates the query.
 */
export function readActivityBody(id: string): Activity | null {
  const engine = getEngine();
  if (!engine?.getActivityBody || !id) return null;

  const body = engine.getActivityBody(id);
  if (!body) return null;
  try {
    return JSON.parse(body) as Activity;
  } catch {
    // A body we cannot parse is a corrupt row, not an activity with no data.
    return null;
  }
}
