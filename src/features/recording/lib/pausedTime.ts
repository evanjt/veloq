/** A pause, in elapsed seconds since the recording started. */
export interface PauseInterval {
  start: number;
  end: number;
}

/**
 * Paused seconds overlapping the window `[from, to]`, both elapsed seconds
 * since the recording started. Stream times are wall clock, so any window
 * measured from them has to give the pauses inside it back.
 */
export function pausedSecondsBetween(
  intervals: readonly PauseInterval[],
  from: number,
  to: number,
): number {
  if (!(to > from)) return 0;
  let total = 0;
  for (const { start, end } of intervals) {
    const lo = Math.max(start, from);
    const hi = Math.min(end, to);
    if (hi > lo) total += hi - lo;
  }
  return total;
}
