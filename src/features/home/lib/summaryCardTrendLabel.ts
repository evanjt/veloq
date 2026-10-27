import type { TFunction } from 'i18next';

import { formatEpochDayUtc } from '@/shared/format/format';
import { glyphMove, type TrendGlyph, type TrendMetric } from '@/shared/format/trend';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';

/**
 * What a summary card arrow was judged against, as the engine read it: an
 * earlier reading on a named day, or the same part of the week before.
 */
export type SummaryTrendBaseline =
  | { kind: 'day'; previous: string | number; date: number }
  | { kind: 'lastWeek'; previous: string | number };

export interface SummaryMetricLabelInput {
  /** The metric's name as a screen reader should say it. */
  name: string;
  value: string | number;
  metric: TrendMetric;
  trend?: TrendGlyph | undefined;
  baseline?: SummaryTrendBaseline | undefined;
}

/**
 * The word for an arrow the engine drew. Up is an improvement even when the
 * number fell, so a judged metric says improved or declined, and a metric with
 * no polarity says only which way the number went.
 */
function moveWord(t: TFunction, metric: TrendMetric, trend: TrendGlyph): string {
  const { verdict, direction } = glyphMove(metric, trend);
  if (verdict === 'improved') return t('summaryCardChange.trend.improved');
  if (verdict === 'declined') return t('summaryCardChange.trend.declined');
  if (direction === 'up') return t('summaryCardChange.trend.rising');
  if (direction === 'down') return t('summaryCardChange.trend.falling');
  return t('summaryCardChange.trend.steady');
}

/**
 * What a screen reader hears for one of the summary card's numbers: the
 * metric and its value, then, beside an arrow, what the arrow means and the
 * reading it was judged against. The arrow alone states neither, and an arrow
 * with no baseline to name is left unspoken rather than described vaguely.
 */
export function summaryMetricLabel(
  t: TFunction,
  { name, value, metric, trend, baseline }: SummaryMetricLabelInput
): string {
  const plain = `${name} ${value}`;
  if (!trend || !baseline) return composeAccessibilityLabel(plain);
  const values = {
    metric: name,
    value,
    move: moveWord(t, metric, trend),
    previous: baseline.previous,
  };
  return composeAccessibilityLabel(
    baseline.kind === 'day'
      ? t('summaryCardChange.trend.comparedOn', {
          ...values,
          date: formatEpochDayUtc(baseline.date),
        })
      : t('summaryCardChange.trend.comparedLastWeek', values)
  );
}
