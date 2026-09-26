/**
 * The trim handles' precision ladder: dragging away from the track slows the
 * handle down so a long section can be cut to a single point.
 *
 * These run on the UI thread, inside the pan gesture, so the level a frame
 * lands on is compared there too. Crossing a threshold is what the haptic
 * marks, and a gesture crosses two of them at most, so the JS thread hears
 * from the worklet twice in a drag rather than sixty times a second.
 */

export type PrecisionLevel = 'normal' | 'precision' | 'fine';

/** How much of the finger's travel the handle takes at this vertical offset. */
export function precisionRatio(dy: number): number {
  'worklet';
  const absDy = Math.abs(dy);
  if (absDy < 20) return 1.0;
  if (absDy < 60) return 0.25;
  return 0.125;
}

export function precisionLevel(dy: number): PrecisionLevel {
  'worklet';
  const absDy = Math.abs(dy);
  if (absDy < 20) return 'normal';
  if (absDy < 60) return 'precision';
  return 'fine';
}
