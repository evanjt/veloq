import type {
  DataPoint,
  InsightMethodology,
  InsightSupportingData,
  Insight,
  PeriodComparison,
  PeriodStats,
  TFunc,
  SeriesPoint,
  SupportingTrend,
  WeeklyTotal,
} from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { ACTIVE_WINDOW_DAYS, INSIGHTS_CONFIG, confidenceFrom } from '../lib/config';
import { formatDurationHuman, formatLoad } from '@/shared/format/format';
import { fitnessTarget, rangeCovering } from '@/shared/app/fitnessEntry';
import { sparkline } from '../lib/sparkline';
import { printedValue } from '../lib/printedValue';
import {
  trendIcon,
  trendOfMetric,
  trendVerdict,
  verdictRung,
  type TrendMetric,
} from '@/shared/format/trend';
import { formatSignedPercent } from '@/shared/format';

/** A week against the week before it. */
const WEEK_OVER_WEEK_DAYS = 14;

/** A week against the four weeks before it, so the whole span is five. */
const WEEK_AGAINST_CHRONIC_DAYS = ACTIVE_WINDOW_DAYS + 7;

/** Weekly totals at the starts supplied by the engine. */
function weeklySeries(weeks: WeeklyTotal[] | undefined, useTss: boolean): SeriesPoint[] {
  if (!weeks) return [];
  return weeks.map((week) => ({
    value: displayValue(useTss ? week.stats.totalTss : week.stats.totalDuration, useTss),
    date: week.start,
    partial: week.partial,
  }));
}

function weeksTarget(weeks: WeeklyTotal[] | undefined, fallbackDays: number): string {
  const first = weeks?.[0];
  const last = weeks?.[weeks.length - 1];
  const days = first && last ? Math.ceil((last.start - first.start) / 86_400) + 7 : 0;
  return fitnessTarget({ range: rangeCovering(Math.max(days, fallbackDays)) });
}

/**
 * The comparison judged by the polarity table. Load is `weekTss`, which has a
 * direction and no judgement, and time is `weekHours`, where more is better.
 * The engine states time in seconds and the table in hours.
 */
function comparisonTrend(comparison: PeriodComparison): {
  metric: TrendMetric;
  trend: SupportingTrend;
} {
  const metric: TrendMetric = comparison.metric === 'tss' ? 'weekTss' : 'weekHours';
  const scale = comparison.metric === 'tss' ? 1 : 1 / 3600;
  const direction = trendOfMetric(metric, comparison.current * scale, comparison.previous * scale);
  return { metric, trend: { direction, verdict: trendVerdict(metric, direction) } };
}

/** A comparison's total as the caption states it, in the unit it was compared in. */
function captionValue(value: number, useTss: boolean): string {
  return useTss ? formatLoad(value) : formatDurationHuman(value);
}

/** A weekly bar's value, which `displayValue` holds in minutes for time, as the caption states it. */
function weeklyCaption(value: number, useTss: boolean): string {
  return captionValue(useTss ? value : value * 60, useTss);
}

/** A comparison's own value as the card shows it: load as it stands, seconds as minutes. */
function displayValue(value: number, useTss: boolean): number {
  return Math.round(useTss ? value : value / 60);
}

export function generatePeriodComparisonInsights(
  currentPeriod: PeriodStats | null,
  previousPeriod: PeriodStats | null,
  chronicPeriod: PeriodStats | null | undefined,
  chronicWeeks: WeeklyTotal[] | undefined,
  weekOverWeek: PeriodComparison | null | undefined,
  weekAgainstChronic: PeriodComparison | null | undefined,
  now: number,
  t: TFunc
): Insight[] {
  const cur = currentPeriod;
  const prev = previousPeriod;
  if (!cur || !prev) return [];

  if (cur.count === 0) {
    return generateLastWeekVsAverageInsight(
      prev,
      chronicPeriod ?? null,
      chronicWeeks,
      weekAgainstChronic ?? null,
      now,
      t
    );
  }

  if (!weekOverWeek) return [];

  const useTss = weekOverWeek.metric === 'tss';
  const ratio = weekOverWeek.ratio;
  const percent = Math.round(Math.abs(ratio) * 100);
  const { metric, trend } = comparisonTrend(weekOverWeek);
  const icon = trendIcon(metric, trend.direction);
  const iconTone = verdictRung(trend.verdict);

  const body = useTss
    ? t('insights.loadBody', {
        currentTss: Math.round(cur.totalTss),
        previousTss: Math.round(prev.totalTss),
        currentDuration: formatDurationHuman(cur.totalDuration),
        previousDuration: formatDurationHuman(prev.totalDuration),
      })
    : t('insights.volumeBody', {
        current: formatDurationHuman(cur.totalDuration),
        previous: formatDurationHuman(prev.totalDuration),
      });

  // Both weeks' activities are what the comparison rests on: a week against
  // one other week is a claim about however many rides made the two.
  const periodConfidence = confidenceFrom('period_comparison', cur.count + prev.count);

  const upKey = useTss ? 'insights.weeklyLoadUp' : 'insights.weeklyVolumeUp';
  const downKey = useTss ? 'insights.weeklyLoadDown' : 'insights.weeklyVolumeDown';

  const comparisonMethodology: InsightMethodology = {
    name: t('insights.methodology.periodComparisonName'),
    description: t('insights.methodology.periodComparison'),
  };
  const caption = t('insights.caption.thisWeekAgainstLast', {
    current: captionValue(weekOverWeek.current, useTss),
    previous: captionValue(weekOverWeek.previous, useTss),
  });

  const thisWeek: DataPoint = {
    label: t('insights.data.thisWeek'),
    value: displayValue(weekOverWeek.current, useTss),
    unit: useTss ? undefined : 'min',
  };
  const weekOverWeekChange: DataPoint = {
    label: t('insights.data.change'),
    value: formatSignedPercent(ratio),
    context: 'neutral',
  };
  const samePointLastWeek: DataPoint = {
    label: t('insights.data.samePointLastWeek'),
    value: displayValue(weekOverWeek.previous, useTss),
    unit: useTss ? undefined : 'min',
  };
  const line = t(useTss ? 'insights.line.weekLoad' : 'insights.line.weekTime', {
    change: printedValue(weekOverWeekChange),
    current: printedValue(thisWeek),
    previous: printedValue(samePointLastWeek),
  });
  const comparisonSupportingData: InsightSupportingData = {
    // The weekly totals in the comparison's unit, including the compared week.
    ...sparkline(
      weeklySeries(chronicWeeks, useTss),
      t('insights.data.weeklyLoad'),
      weeksTarget(chronicWeeks, WEEK_OVER_WEEK_DAYS),
      {
        kind: 'bars',
        mark: { date: weekOverWeek.comparedStart },
        format: (value) => weeklyCaption(value, useTss),
      }
    ),
    trend,
    hero: thisWeek,
    comparisonData: {
      current: thisWeek,
      previous: samePointLastWeek,
      change: weekOverWeekChange,
    },
    change: weekOverWeekChange,
    dataPoints: [
      {
        label: t('insights.data.activitiesThisWeek'),
        value: cur.count,
      },
      {
        label: t('insights.data.activitiesLastWeek'),
        value: prev.count,
      },
    ],
  };

  const periodMeta = {
    sourceTimestamp: now,
    comparisonKind: 'self' as const,
  };

  const insights: Insight[] = [];
  if (ratio > INSIGHTS_CONFIG.thresholds.volumeChangePct) {
    insights.push(
      makeInsight({
        id: 'period_comparison-volume',
        category: 'period_comparison',
        priority: 2,
        icon,
        iconTone,
        title: t(upKey, { percent }),
        subtitle: caption,
        line,
        body,
        // A comparison is a picture of a fitness window, so it opens that
        // window. It used to open the Insights tab, which is where the sheet
        // was opened from, so the tap read as doing nothing.
        navigationTarget: weeksTarget(chronicWeeks, WEEK_OVER_WEEK_DAYS),
        timestamp: now,
        confidence: periodConfidence,
        methodology: comparisonMethodology,
        supportingData: comparisonSupportingData,
        meta: periodMeta,
      })
    );
  } else if (ratio < -INSIGHTS_CONFIG.thresholds.volumeChangePct) {
    insights.push(
      makeInsight({
        id: 'period_comparison-volume',
        category: 'period_comparison',
        priority: 2,
        icon,
        iconTone,
        title: t(downKey, { percent }),
        subtitle: caption,
        line,
        body,
        // A comparison is a picture of a fitness window, so it opens that
        // window. It used to open the Insights tab, which is where the sheet
        // was opened from, so the tap read as doing nothing.
        navigationTarget: weeksTarget(chronicWeeks, WEEK_OVER_WEEK_DAYS),
        timestamp: now,
        confidence: periodConfidence,
        methodology: comparisonMethodology,
        supportingData: comparisonSupportingData,
        meta: periodMeta,
      })
    );
  }

  return insights;
}

function generateLastWeekVsAverageInsight(
  prev: PeriodStats,
  chronic: PeriodStats | null,
  chronicWeeks: WeeklyTotal[] | undefined,
  comparison: PeriodComparison | null,
  now: number,
  t: TFunc
): Insight[] {
  if (prev.count === 0 || !chronic || !comparison) return [];

  const useTss = comparison.metric === 'tss';
  const ratio = comparison.ratio;
  const percent = Math.round(Math.abs(ratio) * 100);
  if (percent < Math.round(INSIGHTS_CONFIG.thresholds.volumeChangePct * 100)) return [];

  const direction = ratio > 0 ? t('insights.weeklyLoad.above') : t('insights.weeklyLoad.below');
  const { metric, trend } = comparisonTrend(comparison);
  const lastWeek: DataPoint = {
    label: t('insights.data.lastWeek'),
    value: displayValue(comparison.current, useTss),
    unit: useTss ? undefined : 'min',
  };
  const chronicChange: DataPoint = {
    label: t('insights.data.change'),
    value: formatSignedPercent(ratio),
    context: 'neutral',
  };
  const fourWeekAverage: DataPoint = {
    label: t('insights.data.fourWeekAvgTss'),
    value: displayValue(comparison.previous, useTss),
    unit: useTss ? undefined : 'min',
  };

  return [
    makeInsight({
      id: 'period_comparison-volume',
      category: 'period_comparison',
      priority: 2,
      icon: trendIcon(metric, trend.direction),
      iconTone: verdictRung(trend.verdict),
      title: t('insights.weeklyLoad.title', { percent, direction }),
      subtitle: t('insights.caption.lastWeekAgainstAverage', {
        current: captionValue(comparison.current, useTss),
        previous: captionValue(comparison.previous, useTss),
      }),
      line: t(useTss ? 'insights.line.lastWeekLoad' : 'insights.line.lastWeekTime', {
        change: printedValue(chronicChange),
        current: printedValue(lastWeek),
        previous: printedValue(fourWeekAverage),
      }),
      navigationTarget: weeksTarget(chronicWeeks, WEEK_AGAINST_CHRONIC_DAYS),
      timestamp: now,
      // A week against a chronic average: the week's activities plus the ones
      // the average was built from.
      confidence: confidenceFrom('period_comparison', prev.count + chronic.count),
      meta: {
        sourceTimestamp: now,
        comparisonKind: 'self',
      },
      supportingData: {
        ...sparkline(
          weeklySeries(chronicWeeks, useTss),
          t('insights.data.weeklyLoad'),
          weeksTarget(chronicWeeks, WEEK_AGAINST_CHRONIC_DAYS),
          {
            kind: 'bars',
            mark: { date: comparison.comparedStart },
            format: (value) => weeklyCaption(value, useTss),
          }
        ),
        trend,
        hero: lastWeek,
        comparisonData: {
          current: lastWeek,
          previous: fourWeekAverage,
          change: chronicChange,
        },
        change: chronicChange,
      },
      methodology: {
        name: t('insights.methodology.periodComparisonName'),
        description: t('insights.methodology.periodComparisonRestDay'),
      },
    }),
  ];
}
