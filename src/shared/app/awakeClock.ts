/**
 * A clock that does not count the time the process spent suspended.
 *
 * `app.json` declares three background modes, so outside those iOS suspends
 * the app: no timer fires, no poll runs, and the wall clock keeps going. A
 * deadline measured on `Date.now` therefore expires while nothing was watching
 * it, and the first poll after the resume reports a healthy run stuck. The GPS
 * download poll cancelled the pass and the backup threw over a copy that was
 * still running.
 *
 * A poll knows how long its own tick should take, so a gap far longer than
 * that is the process having been away rather than the work standing still.
 * The overshoot is dropped and the deadline gets its budget back.
 *
 * Call it once per tick. It measures the gap between calls, so a caller that
 * reads it far less often than its interval reads its own idleness as a
 * suspension.
 */

/**
 * How much longer than one interval a tick may take before it is read as a
 * suspension. Generous, because a blocking engine call or a slow copy can hold
 * the thread for a second or two, and far short of either poller's deadline.
 */
export const SUSPENSION_GRACE_MS = 5_000;

/**
 * Reads the clock, discounting every gap that looks like a suspension.
 *
 * `intervalMs` is what one tick of the caller's loop is meant to take.
 */
export function createAwakeClock(intervalMs: number, now: () => number = Date.now): () => number {
  let last = now();
  let suspended = 0;

  return () => {
    const at = now();
    const gap = at - last;
    if (gap > intervalMs + SUSPENSION_GRACE_MS) suspended += gap - intervalMs;
    last = at;
    return at - suspended;
  };
}
