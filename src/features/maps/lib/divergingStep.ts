/**
 * The seven-step diverging banding the map line shares between grade and
 * ahead or behind. Steps rather than a blend, so a colour always means one
 * band, and fixed thresholds rather than a scale fitted to the line, so two
 * attempts or two activities read alike.
 *
 * Grade bands the slope in percent: within 2 % is flat, then 2 to 5, 5 to 10
 * and beyond 10 on either side, cool descending and warm climbing. Pace bands
 * the time over a stretch against the reference's, in percent of the
 * reference's: within 1 % is level, then 1 to 3, 3 to 6 and beyond 6, cool
 * faster and warm slower.
 */

import type { MapDivStep } from '@/theme';

/** What a diverging line bands: the grade, or the time against a reference. */
export type DivergingKind = 'grade' | 'pace';

/** One step of the ramp and the values it holds, from `from` to `to` percent. */
export interface DivergingBand {
  step: MapDivStep;
  from: number;
  to: number;
}

/** The middle band's half-width and the two edges beyond it, in percent. */
const THRESHOLDS: Record<DivergingKind, readonly [number, number, number]> = {
  grade: [2, 5, 10],
  pace: [1, 3, 6],
};

const COOL = ['cool-1', 'cool-2', 'cool-3'] as const;
const WARM = ['warm-1', 'warm-2', 'warm-3'] as const;

function bandsFor(kind: DivergingKind): readonly DivergingBand[] {
  const [mid, near, far] = THRESHOLDS[kind];
  return [
    { step: 'cool-3', from: -Infinity, to: -far },
    { step: 'cool-2', from: -far, to: -near },
    { step: 'cool-1', from: -near, to: -mid },
    { step: 'mid', from: -mid, to: mid },
    { step: 'warm-1', from: mid, to: near },
    { step: 'warm-2', from: near, to: far },
    { step: 'warm-3', from: far, to: Infinity },
  ];
}

/** Each kind's seven bands from the cool end to the warm end, which the key lists. */
export const DIVERGING_BANDS: Readonly<Record<DivergingKind, readonly DivergingBand[]>> = {
  grade: bandsFor('grade'),
  pace: bandsFor('pace'),
};

/**
 * The step `value` falls in. A band holds its edge nearer the middle, and the
 * middle band both of its own, so 2 % of grade is flat and 5 % is the first
 * climbing step. A value that is not a finite number has no step.
 */
export function divergingStep(value: number, kind: DivergingKind): MapDivStep | null {
  if (!Number.isFinite(value)) return null;
  const [mid, near, far] = THRESHOLDS[kind];
  const size = Math.abs(value);
  if (size <= mid) return 'mid';
  const level = size <= near ? 0 : size <= far ? 1 : 2;
  return (value < 0 ? COOL : WARM)[level];
}
