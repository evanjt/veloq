/**
 * The activity's stored body, asking Rust for it when it is absent and waiting
 * for the announcement rather than re-reading on a timer.
 *
 * Two things used to make the read expensive and both are gone. It ran on a
 * timer, four times a second for as long as the fetch took, and Rust now
 * announces the landing on `bodyStored` with the id, so between the request
 * and the event this costs no engine call at all. And it read `getActivityBodies`
 * over a thirty-day window and parsed every body in JavaScript to find the one
 * id, which is a page of JSON work in the headless push task, the least
 * affordable place for it. `activity_bodies` is keyed by the id, so the engine
 * answers for one activity in one row.
 */

import type { StartOutcome } from 'veloqrs';

/** Max time to wait for the engine to store the body. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** The engine surface this needs, so a caller can hand it a double. */
export interface ActivityBodyReader {
  getActivityBody: (activityId: string) => string | null;
  syncActivityDetail: (activityId: string) => StartOutcome;
  subscribe: (event: string, callback: (payload?: { activityId?: string }) => void) => () => void;
}

/** The stored body for one activity, or null if the engine has not got it. */
export function readStoredActivity(
  engine: ActivityBodyReader,
  activityId: string
): Record<string, unknown> | null {
  const raw = engine.getActivityBody(activityId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A body that will not parse is no better than one that is not there.
    return null;
  }
}

/**
 * The body for `activityId`, requesting it when it is not already stored.
 * Null when it has not landed by `timeoutMs`, which leaves the caller to
 * decide whether a notification without a name is worth writing.
 */
export function awaitActivityBody(
  engine: ActivityBodyReader,
  activityId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Record<string, unknown> | null> {
  const stored = readStoredActivity(engine, activityId);
  if (stored) return Promise.resolve(stored);

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (body: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      resolve(body);
    };

    // An announcement names the activity, so a body landing for a different
    // one costs nothing. Only ours is read back, and only once.
    const unsubscribe = engine.subscribe('bodyStored', (payload) => {
      if (payload?.activityId !== activityId) return;
      const landed = readStoredActivity(engine, activityId);
      // The announcement is the write, so this should be here. If it is not,
      // keep waiting rather than reporting a body we have not read.
      if (landed) finish(landed);
    });

    timer = setTimeout(() => finish(null), timeoutMs);

    engine.syncActivityDetail(activityId);
  });
}
