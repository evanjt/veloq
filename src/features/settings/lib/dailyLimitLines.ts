import type { TFunction } from 'i18next';

/** The backfill's daily figure as the engine's governor reports it. */
export interface DailyLimit {
  used: number;
  perDay: number;
  /** When this install's daily count next resets, epoch milliseconds. */
  resetsAtMs: number;
}

/** The three lines the range panel prints under its progress bar. */
export interface DailyLimitLines {
  shared: string;
  today: string;
  reset: string;
}

/**
 * The shared-limit line and today's figure with its reset time. The figure and
 * the reset come from the engine's governor, so they move when the allowance
 * does. Null where the governor reports no daily limit.
 */
export function dailyLimitLines(
  limit: DailyLimit | null | undefined,
  t: TFunction,
  formatReset: (epochMs: number) => string
): DailyLimitLines | null {
  if (!limit) return null;
  return {
    shared: t('settings.dailyLimitShared'),
    today: t('settings.dailyLimitToday', { used: limit.used, limit: limit.perDay }),
    reset: t('settings.dailyLimitResets', { time: formatReset(limit.resetsAtMs) }),
  };
}
