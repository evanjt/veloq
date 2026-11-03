import type { TFunction } from 'i18next';

import { formatDaySpan, type SpanTranslator } from '@/shared/format/daySpan';

const MS_PER_DAY = 86_400_000;

/**
 * The Settings row's summary of the activity history: the span from the oldest synced day to
 * today, and the activities held. An unknown start gives an empty string, which the row leaves
 * without a subtitle.
 */
export function activityHistorySummary(
  oldest: string,
  now: Date,
  activityCount: number,
  t: TFunction
): string {
  if (!oldest) return '';
  const start = new Date(`${oldest.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  const days = Math.max(0, Math.round((now.getTime() - start.getTime()) / MS_PER_DAY));
  return t('settings.activityHistorySummary', {
    span: formatDaySpan(days, t as unknown as SpanTranslator),
    activities: activityCount,
  });
}
