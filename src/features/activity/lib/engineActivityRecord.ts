import type { ActivityRecord } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';

/**
 * The stored activity for one id, typed by the engine.
 *
 * `activity_bodies` is keyed by `activity_id`, so this is a primary-key read.
 * It is named for the one activity rather than for the window that contains
 * its day: the window read returns every body in range and leaves the caller
 * parsing all of them to find one, which on a 490-activity library is 490
 * `JSON.parse` calls on the JS thread, repeated on every sync event that
 * invalidates the query.
 */
export function readActivityRecord(id: string): ActivityRecord | null {
  const engine = getEngine();
  if (!engine?.getActivityRecord || !id) return null;
  return engine.getActivityRecord(id) ?? null;
}
