/** Translator the span formatter needs; `t` from react-i18next satisfies it. */
export type SpanTranslator = (key: string, options: { count: number }) => string;

const DAYS_PER_YEAR = 365;

/** A span of days as years from 365 days up, otherwise as days. */
export function formatDaySpan(days: number, t: SpanTranslator): string {
  if (days >= DAYS_PER_YEAR) {
    return t('time.yearsCount', { count: Math.round(days / DAYS_PER_YEAR) });
  }
  return t('time.daysCount', { count: days });
}
