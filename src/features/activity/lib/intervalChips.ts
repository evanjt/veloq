import { intervalBandToken, resolveBandColour } from '@/features/stats';
import type { ActivityInterval } from '@/types';

/** One chip in the key above the intervals table: a kind of interval, how many, and for how long. */
export interface IntervalChip {
  label: string;
  /** The fill of the interval's band behind the chart, so the chip keys it. */
  color: string;
  count: number;
  totalTime: number;
}

const ROLE_LABELS = {
  work: 'W',
  recovery: 'Rec',
  warmup: 'WU',
  cooldown: 'CD',
} as const;

/**
 * Folds the intervals into one chip per zone or role, in order of first
 * appearance. An interval with no moving time still counts as one, it just
 * adds nothing to the total.
 */
export function intervalChips(
  intervals: readonly ActivityInterval[],
  scale: 'power' | 'hr',
  isDark: boolean
): IntervalChip[] {
  const chips: IntervalChip[] = [];
  const byKey = new Map<string, IntervalChip>();

  for (const interval of intervals) {
    const token = intervalBandToken(interval, scale);
    let key: string;
    let label: string;
    if (token.kind === 'zone') {
      key = label = `Z${token.zone}`;
    } else if (token.role === 'other') {
      key = interval.type;
      label = interval.type.slice(0, 3);
    } else {
      key = token.role;
      label = ROLE_LABELS[token.role];
    }

    const movingTime = interval.moving_time ?? 0;
    const chip = byKey.get(key);
    if (chip) {
      chip.count++;
      chip.totalTime += movingTime;
    } else {
      const created = {
        label,
        color: resolveBandColour(token, isDark),
        count: 1,
        totalTime: movingTime,
      };
      byKey.set(key, created);
      chips.push(created);
    }
  }
  return chips;
}
