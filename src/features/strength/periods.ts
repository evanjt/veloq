import { periodOptions, type Period } from '@/shared/app/period';

/** The strength tab's periods: a week to six months, from the one vocabulary. */
export type StrengthPeriod = Extract<Period, '7d' | '1m' | '3m' | '6m'>;

export const STRENGTH_PERIODS = periodOptions<StrengthPeriod>(['7d', '1m', '3m', '6m']);

/**
 * The strength period a link names, or null for a missing or unknown one, so a
 * link can only pick a period the tab itself offers.
 */
export function strengthPeriodOf(value: string | undefined): StrengthPeriod | null {
  return STRENGTH_PERIODS.find((option) => option.id === value)?.id ?? null;
}
