/**
 * The activity's stored body, asking Rust for it when it is absent and waiting
 * for the announcement rather than re-reading on a timer.
 *
 * The read is not cheap: `getActivityBodies` takes the engine lock and hands
 * back every body in the window, each of which has to be parsed to find the
 * one id we are after. On a timer that ran four times a second for as long as
 * the fetch took. Rust announces the landing on `bodyStored` with the id, so
 * between the request and the event this costs no engine call at all.
 */

/** How far back to look for the activity a push is about. */
const LOOKBACK_DAYS = 30;

/** Max time to wait for the engine to store the body. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** The engine surface this needs, so a caller can hand it a double. */
export interface ActivityBodyReader {
  getActivityBodies: (oldestTs: number, newestTs: number) => string[];
  syncActivityDetail: (activityId: string) => boolean;
  subscribe: (event: string, callback: (payload?: { activityId?: string }) => void) => () => void;
}

/** The stored body for one activity, or null if the engine has not got it. */
export function readStoredActivity(
  engine: ActivityBodyReader,
  activityId: string
): Record<string, unknown> | null {
  const newest = Math.floor(Date.now() / 1000) + 86_400;
  const oldest = newest - LOOKBACK_DAYS * 86_400;
  for (const body of engine.getActivityBodies(oldest, newest)) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed?.id === activityId) return parsed;
    } catch {
      // A body that will not parse is not the one we are after.
    }
  }
  return null;
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
