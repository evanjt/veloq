import type { StrengthBalancePair, StrengthBalanceStatus } from '../types';

/** Format a set count: integers stay integer, fractions get one decimal. */
export function formatSetCount(sets: number): string {
  return sets % 1 === 0 ? sets.toFixed(0) : sets.toFixed(1);
}

export type BalanceCopyKey =
  | 'insights.strengthBalance.oneSided'
  | 'insights.strengthBalance.noSignal';
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
  return `${pair.ratio.toFixed(pair.ratio >= 10 ? 0 : 1)}x`;
}

const BALANCE_STATUS_LABEL_KEYS = {
  balanced: 'insights.strengthBalance.balanced',
  watch: 'insights.strengthBalance.watch',
  imbalanced: 'insights.strengthBalance.imbalanced',
  'one-sided': 'insights.strengthBalance.oneSided',
  insufficient: 'insights.strengthBalance.lowSignal',
} as const satisfies Record<StrengthBalanceStatus, string>;

/**
 * The translation key that names a balance verdict. The insight card and the
 * strength tab both name it, so they take the key from here.
 */
export function balanceStatusLabelKey(status: StrengthBalanceStatus) {
  return BALANCE_STATUS_LABEL_KEYS[status];
}
