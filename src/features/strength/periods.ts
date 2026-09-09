import { periodOptions, type Period } from '@/shared/app/period';

/** The strength tab's periods: a week to six months, from the one vocabulary. */
export type StrengthPeriod = Extract<Period, '7d' | '1m' | '3m' | '6m'>;

export const STRENGTH_PERIODS = periodOptions<StrengthPeriod>(['7d', '1m', '3m', '6m']);
