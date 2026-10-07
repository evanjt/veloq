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

import { awaitEngineAnnouncement } from '@/shared/native/awaitEngineAnnouncement';
import { hasStarted, isRetryableStart, type StartOutcome, type StartResult } from 'veloqrs';

/** Max time to wait for the engine to store the body. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** The engine surface this needs, so a caller can hand it a double. */
export interface ActivityBodyReader {
  getActivityBody: (activityId: string) => string | null;
  syncActivityDetail: (activityId: string) => StartOutcome | StartResult;
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

  const refused = new AbortController();

  // An announcement names the activity, so a body landing for a different
  // one costs nothing. Only ours is read back, and only once. The
  // announcement is the write, so the body should be there. If it is not,
  // keep waiting rather than reporting a body we have not read.
  const body = awaitEngineAnnouncement<Record<string, unknown> | null>({
    channel: 'bodyStored',
    timeoutMs,
    read: (payload) =>
      (payload as { activityId?: string } | undefined)?.activityId === activityId
        ? (readStoredActivity(engine, activityId) ?? undefined)
        : undefined,
    onDeadline: () => null,
    subscribe: (channel, listener) => engine.subscribe(channel, listener),
    signal: refused.signal,
  });

  // A refusal that asking again cannot change is the answer. There is no
  // credential, or there is nothing to fetch, so the fifteen seconds buy
  // nothing and the headless task spends them before it can write anything
  // at all. A retryable refusal is different: the work may still land from
  // whatever holds the slot, so that one waits.
  const outcome = engine.syncActivityDetail(activityId);
  if (!hasStarted(outcome) && !isRetryableStart(outcome)) refused.abort();

  return body;
}
