/**
 * The bounds of a trimmed index range, as every trim control moves them.
 *
 * These run on the UI thread inside pan gestures as well as on the JS thread for
 * buttons and screen reader actions, so a drag, a step and an action all clamp the
 * same way.
 */

export type TrimBound = 'start' | 'end';

/** The smallest part of the range a trim keeps, as a fraction of it. */
const MIN_KEPT_FRACTION = 0.05;

/**
 * The fewest intervals a trim keeps between its bounds: five per cent of the range, or
 * one handle width of the track when that is wider, so two handles never cover each other.
 * A track not yet measured counts only the five per cent.
 */
export function trimMinGap(maxIndex: number, trackWidth = 0, handleSize = 0): number {
  'worklet';
  if (maxIndex <= 0) return 0;
  const byFraction = Math.ceil(maxIndex * MIN_KEPT_FRACTION);
  const byHandle = trackWidth > 0 ? Math.ceil((maxIndex * handleSize) / trackWidth) : 0;
  return Math.max(byFraction, byHandle);
}

/**
 * Where `bound` lands after moving `delta` points, held between 0 and `maxIndex` and at
 * least `minGap` from the other bound. A range already tighter than the gap leaves the
 * bound in place rather than moving it against the step.
 */
export function stepTrimBound(
  start: number,
  end: number,
  maxIndex: number,
  bound: TrimBound,
  delta: number,
  minGap: number
): number {
  'worklet';
  const current = bound === 'start' ? start : end;
  const lowest = bound === 'start' ? 0 : start + minGap;
  const highest = bound === 'start' ? end - minGap : maxIndex;
  const target = Math.max(0, Math.min(current + delta, maxIndex));
  if (target > current) return Math.max(current, Math.min(target, highest));
  if (target < current) return Math.min(current, Math.max(target, lowest));
  return current;
}
