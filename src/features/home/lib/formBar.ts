/**
 * The zone bar under the summary card's fitness sparkline.
 *
 * Each day is drawn in the zone the engine judged for it, on that day's form
 * against that day's fitness under the athlete's setting, which is what the
 * hero above it and the widget's bar read. The series is oldest first.
 */

import type { FormZone } from '@/features/fitness';

export interface FormBarRect {
  x: number;
  width: number;
  /** Null on a day with no fitness under the percentage setting, which draws nothing. */
  zone: FormZone | null;
}

/**
 * One rect per day across `width`, on the sparkline's N-1 interval spacing so
 * the crosshair lines up with them, and a divider at the midpoint between two
 * days whose zones differ.
 */
export function formBarLayout(
  zones: readonly (FormZone | null)[],
  width: number
): { rects: FormBarRect[]; transitions: number[] } {
  const n = zones.length;
  const step = n > 1 ? width / (n - 1) : width;
  const rects = zones.map((zone, i) => {
    const px = i * step;
    const left = i === 0 ? 0 : (px + (i - 1) * step) / 2;
    const right = i === n - 1 ? width : (px + (i + 1) * step) / 2;
    return {
      x: left,
      width: right - left + 0.5,
      zone,
    };
  });
  const transitions: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    if (zones[i] !== zones[i + 1]) transitions.push((i * step + (i + 1) * step) / 2);
  }
  return { rects, transitions };
}
