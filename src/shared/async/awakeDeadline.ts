/**
 * Give a promise a ceiling the athlete's session can carry, and say which of
 * the two arrived first.
 *
 * The engine's long jobs are Promises now rather than slots a screen polls, and
 * Every foreground wait has a ceiling a session can carry: past it the screen
 * stops waiting and says the work is still going, rather than leaving a spinner
 * nobody can give up on. Rust keeps working either way, so the ceiling belongs
 * here and not in the export.
 *
 * The clock is the awake one: outside its three background modes the app is
 * suspended, no timer fires, and a deadline read off `Date.now` expires over a
 * job that never stopped running. So the budget is sampled on a tick and every
 * gap that looks like a suspension is given back.
 */
import { createAwakeClock } from '@/shared/app/awakeClock';

/**
 * How often the budget is read. Far shorter than any ceiling, and long enough
 * that watching one costs nothing: the tick does arithmetic and nothing else.
 */
const SAMPLE_MS = 500;

/** Either the work's own answer, or the ceiling arriving first. */
export type AwakeOutcome<T> = { state: 'complete'; value: T } | { state: 'stillRunning' };

/**
 * Wait for `work`, for at most `timeoutMs` of awake time.
 *
 * A rejection is the caller's to handle and comes back as one. A rejection
 * after the ceiling has passed is swallowed instead: nobody is waiting for it
 * by then, and an unhandled rejection would take the app down over a job the
 * screen has already stopped watching.
 */
export async function withAwakeDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  sampleMs: number = SAMPLE_MS
): Promise<AwakeOutcome<T>> {
  let timer: ReturnType<typeof setInterval> | null = null;

  const ceiling = new Promise<AwakeOutcome<T>>((resolve) => {
    const awake = createAwakeClock(sampleMs);
    const deadline = awake() + timeoutMs;
    timer = setInterval(() => {
      if (awake() > deadline) resolve({ state: 'stillRunning' });
    }, sampleMs);
  });

  try {
    const outcome = await Promise.race([
      work.then((value) => ({ state: 'complete', value }) as AwakeOutcome<T>),
      ceiling,
    ]);
    if (outcome.state === 'stillRunning') work.catch(() => {});
    return outcome;
  } finally {
    if (timer !== null) clearInterval(timer);
  }
}
