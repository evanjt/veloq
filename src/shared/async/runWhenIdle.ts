/**
 * Run work once the JS thread has nothing queued, and let the caller take it back.
 *
 * Costly engine reads block the thread for their whole duration, so a screen
 * that arrives with one waits for the frame it is arriving on to finish rather
 * than stalling it. The deadline keeps a thread that never idles from holding
 * the work back for ever.
 */

/** Undoes a scheduled run. Safe to call after it has run or been cancelled. */
export type Cancel = () => void;

/** Longest the work waits for an idle period, in milliseconds. */
export const IDLE_DEADLINE_MS = 1000;

export function runWhenIdle(task: () => void, deadlineMs: number = IDLE_DEADLINE_MS): Cancel {
  let cancelled = false;
  const id = requestIdleCallback(
    () => {
      if (!cancelled) task();
    },
    { timeout: deadlineMs }
  );
  return () => {
    cancelled = true;
    cancelIdleCallback(id);
  };
}
