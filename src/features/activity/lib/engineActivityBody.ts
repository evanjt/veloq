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

/**
 * Whether a stored body is the detail form rather than the lighter row the
 * list sync wrote.
 *
 * The list asks for a fixed field set (`ACTIVITY_FIELDS` in the engine's
 * `net/types.rs`) and intervals.icu drops the ones the activity has nothing
 * for, so a list body's key set varies per activity and its size says
 * nothing. `icu_athlete_id` is not in that set and cannot be, so a body
 * carrying it came from `GET /activity/{id}`.
 *
 * Measured against the real API on 2026-09-12: a list pull returned 20 keys
 * for a run and the detail 183, and `icu_athlete_id` was present on all
 * twelve activities sampled, across runs, hikes, weight training, and
 * bodies created by both Garmin Connect and an OAuth client.
 */
export function hasDetailBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const athleteId = (body as { icu_athlete_id?: unknown }).icu_athlete_id;
  return typeof athleteId === 'string' && athleteId.length > 0;
}
