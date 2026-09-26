import type {
  InsightMethodology,
  InsightSupportingData,
  Insight,
  PeriodComparison,
  PeriodStats,
  TFunc,
  SeriesPoint,
} from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { ACTIVE_WINDOW_DAYS, INSIGHTS_CONFIG, confidenceFrom } from '../lib/config';
import { formatDurationCompact } from '@/shared/format/format';
import { fitnessTarget, rangeCovering } from '@/shared/app/fitnessEntry';
import { sparkline } from '../lib/sparkline';

/** A week against the week before it. */
const WEEK_OVER_WEEK_DAYS = 14;

/** A week against the four weeks before it, so the whole span is five. */
const WEEK_AGAINST_CHRONIC_DAYS = ACTIVE_WINDOW_DAYS + 7;

/**
 * The chronic weeks as the points a strip is drawn from, in the unit the
 * comparison is stated in. Dated at the engine's own week boundaries would be
 * better, but the bundle sends totals rather than ranges, so the index stands
 * in: the strip is a shape and not a timeline.
 */
function weeklySeries(weeks: PeriodStats[] | undefined, useTss: boolean): SeriesPoint[] {
  if (!weeks) return [];
  return weeks.map((week, at) => ({
    value: displayValue(useTss ? week.totalTss : week.totalDuration, useTss),
    date: at,
  }));
}

/** A comparison's own value as the card shows it: TSS as it stands, seconds as minutes. */
function displayValue(value: number, useTss: boolean): number {
  return Math.round(useTss ? value : value / 60);
}

export function generatePeriodComparisonInsights(
  currentPeriod: PeriodStats | null,
  previousPeriod: PeriodStats | null,
  chronicPeriod: PeriodStats | null | undefined,
  chronicWeeks: PeriodStats[] | undefined,
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
      weekAgainstChronic ?? null,
      now,
      t
    );
  }

  if (!weekOverWeek) return [];

  const useTss = weekOverWeek.metric === 'tss';
  const ratio = weekOverWeek.ratio;
  const percent = Math.round(Math.abs(ratio) * 100);

  const body = useTss
    ? t('insights.loadBody', {
        currentTss: Math.round(cur.totalTss),
        previousTss: Math.round(prev.totalTss),
        currentDuration: formatDurationCompact(cur.totalDuration),
        previousDuration: formatDurationCompact(prev.totalDuration),
      })
    : t('insights.volumeBody', {
        current: formatDurationCompact(cur.totalDuration),
        previous: formatDurationCompact(prev.totalDuration),
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

  const comparisonSupportingData: InsightSupportingData = {
    // The four weeks behind the chronic total, in whichever unit the
    // comparison is stated in, so the strip and the numbers agree.
    ...sparkline(weeklySeries(chronicWeeks, useTss), t('insights.data.weeklyLoad')),
    comparisonData: {
      current: {
        label: t('insights.data.thisWeek'),
        value: displayValue(weekOverWeek.current, useTss),
        unit: useTss ? 'TSS' : 'min',
      },
      previous: {
        label: t('insights.data.lastWeek'),
        value: displayValue(weekOverWeek.previous, useTss),
        unit: useTss ? 'TSS' : 'min',
      },
      change: {
        label: t('insights.data.change'),
        value: `${ratio > 0 ? '+' : ''}${percent}%`,
        context: 'neutral',
      },
    },
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
        icon: 'trending-up',
        iconTone: 'positive',
        title: t(upKey, { percent }),
        body,
        // A comparison is a picture of a fitness window, so it opens that
        // window. It used to open the Insights tab, which is where the sheet
        // was opened from, so the tap read as doing nothing.
        navigationTarget: fitnessTarget({ range: rangeCovering(WEEK_OVER_WEEK_DAYS) }),
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
        icon: 'trending-down',
        iconTone: 'negative',
        title: t(downKey, { percent }),
        body,
        // A comparison is a picture of a fitness window, so it opens that
        // window. It used to open the Insights tab, which is where the sheet
        // was opened from, so the tap read as doing nothing.
        navigationTarget: fitnessTarget({ range: rangeCovering(WEEK_OVER_WEEK_DAYS) }),
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

  return [
    makeInsight({
      id: 'period_comparison-volume',
      category: 'period_comparison',
      priority: 2,
      icon: ratio > 0 ? 'trending-up' : 'trending-down',
      iconTone: ratio > 0 ? 'positive' : 'negative',
      title: t('insights.weeklyLoad.title', { percent, direction }),
      navigationTarget: fitnessTarget({ range: rangeCovering(WEEK_AGAINST_CHRONIC_DAYS) }),
      timestamp: now,
      // A week against a chronic average: the week's activities plus the ones
      // the average was built from.
      confidence: confidenceFrom('period_comparison', prev.count + chronic.count),
      meta: {
        sourceTimestamp: now,
        comparisonKind: 'self',
      },
      supportingData: {
        comparisonData: {
          current: {
            label: t('insights.data.lastWeek'),
            value: displayValue(comparison.current, useTss),
            unit: useTss ? 'TSS' : 'min',
          },
          previous: {
            label: t('insights.data.fourWeekAvgTss'),
            value: displayValue(comparison.previous, useTss),
            unit: useTss ? 'TSS' : 'min',
          },
          change: {
            label: t('insights.data.change'),
            value: `${ratio > 0 ? '+' : '-'}${percent}%`,
            context: 'neutral',
          },
        },
      },
      methodology: {
        name: t('insights.methodology.periodComparisonName'),
        description: t('insights.methodology.periodComparisonRestDay'),
      },
    }),
  ];
}
