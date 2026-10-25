import type { ActivityRecord } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';
import type { FeedCard } from '../types';

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

/**
 * The feed's cards over an inclusive date window, newest first, typed by the
 * engine. Empty when the engine is not open.
 */
export function readFeedCards(oldest: string, newest: string): FeedCard[] {
  const engine = getEngine();
  if (!engine?.getFeedCards) return [];
  return engine.getFeedCards(
    dayStartEpochSeconds(oldest),
    dayEndEpochSeconds(newest)
  ) as FeedCard[];
}

/**
 * Ask the engine to ready one activity again: fetch and store the bodies it
 * still lacks. Settles when the engine has finished, whether or not the
 * activity is ready, because the engine owns the "couldn't sync" mark and
 * clears it only when the activity next readies cleanly.
 */
export async function retryActivitySync(id: string): Promise<void> {
  const engine = getEngine();
  if (!engine?.readyActivityBodies || !id) return;
  await engine.readyActivityBodies(id);
}
