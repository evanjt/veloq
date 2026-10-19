import { ABSENT } from '@/shared/format/absent';
import { formatWeight } from '@/shared/format/weight';

import type { StrengthBalancePair, StrengthBalanceStatus } from '../types';
import { formatDecimal } from '@/shared/format';

/** Format a set count: integers stay integer, fractions get one decimal. */
export function formatSetCount(sets: number): string {
  return formatDecimal(sets, sets % 1 === 0 ? 0 : 1);
}

/**
 * A best set as the figures it carries: load and repetitions, the repetitions
 * alone for a body-weight set the engine sends with no load, the load alone
 * when no count was logged, and the absent mark when it carries neither.
 */
export function formatBestSet(
  set: { weightKg?: number | undefined; repetitions?: number | undefined },
  isMetric: boolean,
  t: (key: 'strength.repsCount', values: { count: number }) => string
): string {
  const load = set.weightKg == null ? null : formatWeight(set.weightKg, isMetric);
  const reps = set.repetitions == null ? null : t('strength.repsCount', { count: set.repetitions });
  if (load && reps) return `${load} · ${reps}`;
  return load ?? reps ?? ABSENT;
}

export type BalanceCopyKey =
  'insights.strengthBalance.oneSided' | 'insights.strengthBalance.noSignal';
type TFunc = (key: BalanceCopyKey) => string;

/**
 * A ratio against an untrained side is not a number, so the engine sends none
 * and the verdict carries that case: `one-sided` is a reading, `insufficient`
 * and the rest are a pair with nothing to divide. The tab and the insight card
 * both print this.
 */
export function formatBalanceRatio(pair: StrengthBalancePair, t: TFunc): string {
  if (pair.status === 'one-sided') return t('insights.strengthBalance.oneSided');
  if (pair.ratio == null || !Number.isFinite(pair.ratio)) {
    return t('insights.strengthBalance.noSignal');
  }
  return `${formatDecimal(pair.ratio, pair.ratio >= 10 ? 0 : 1)}x`;
}

const BALANCE_STATUS_LABEL_KEYS = {
  balanced: 'insights.strengthBalance.bandLow',
  watch: 'insights.strengthBalance.bandMiddle',
  imbalanced: 'insights.strengthBalance.bandHigh',
  'one-sided': 'insights.strengthBalance.oneSided',
  insufficient: 'insights.strengthBalance.lowSignal',
} as const satisfies Record<StrengthBalanceStatus, string>;

/**
 * The translation key that names the band a pair's ratio falls in, stated as
 * the band's bounds rather than a judgement. The insight card and the strength
 * tab both name it, so they take the key from here.
 */
export function balanceStatusLabelKey(status: StrengthBalanceStatus) {
  return BALANCE_STATUS_LABEL_KEYS[status];
}
