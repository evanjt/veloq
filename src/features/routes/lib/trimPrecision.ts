/**
 * The trim handles' precision ladder: dragging away from the track slows the
 * handle down so a long section can be cut to a single point.
 *
 * These run on the UI thread, inside the pan gesture. A level is entered at
 * its threshold and left only once the finger is a margin back inside it, and
 * a haptic marks a crossing only when the floor has passed since the last one,
 * so a finger wobbling on a threshold fires once and the JS thread is not
 * woken for every touch sample.
 */

export type PrecisionLevel = 'normal' | 'precision' | 'fine';

const PRECISION_AT = 20;
const FINE_AT = 60;
/** How far back inside a threshold the finger must come to leave the level. */
const LEAVE_MARGIN = 6;
/** The shortest gap between two crossing haptics. */
export const HAPTIC_FLOOR_MS = 80;

/** How much of the finger's travel the handle takes at this level. */
export function levelRatio(level: PrecisionLevel): number {
  'worklet';
  if (level === 'normal') return 1.0;
  if (level === 'precision') return 0.25;
  return 0.125;
}

/** The level at this vertical offset, given the level the last update landed on. */
export function precisionLevel(dy: number, previous: PrecisionLevel = 'normal'): PrecisionLevel {
  'worklet';
  const absDy = Math.abs(dy);
  if (absDy >= FINE_AT) return 'fine';
  if (previous === 'fine' && absDy >= FINE_AT - LEAVE_MARGIN) return 'fine';
  if (absDy >= PRECISION_AT) return 'precision';
  if (previous !== 'normal' && absDy >= PRECISION_AT - LEAVE_MARGIN) return 'precision';
  return 'normal';
}

/** A first crossing is marked at once, and a later one only after the floor. */
export function shouldMarkCrossing(nowMs: number, lastFireMs: number): boolean {
  'worklet';
  return lastFireMs <= 0 || nowMs - lastFireMs >= HAPTIC_FLOOR_MS;
}
