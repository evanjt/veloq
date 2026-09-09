import type {
  InsightMethodology,
  InsightSupportingData,
  Insight,
  PeriodStats,
  TFunc,
} from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { INSIGHTS_CONFIG, confidenceFrom } from '../lib/config';
import { insightIcon } from '@/theme';
import { formatDurationCompact } from '@/shared/format/format';

export function generatePeriodComparisonInsights(
  currentPeriod: PeriodStats | null,
  previousPeriod: PeriodStats | null,
  chronicPeriod: PeriodStats | null | undefined,
  now: number,
  t: TFunc
): Insight[] {
  const cur = currentPeriod;
  const prev = previousPeriod;
  if (!cur || !prev) return [];

  if (cur.count === 0) {
    return generateLastWeekVsAverageInsight(prev, chronicPeriod ?? null, now, t);
  }

  const useTss = prev.totalTss > 0 && cur.totalTss > 0;
  const curValue = useTss ? cur.totalTss : cur.totalDuration;
  const prevValue = useTss ? prev.totalTss : prev.totalDuration;

  if (prevValue <= 0) return [];

  const ratio = curValue / prevValue - 1;
  const percent = Math.round(Math.abs(ratio) * 100);

  if (curValue === 0) return [];

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
    comparisonData: {
      current: {
        label: t('insights.data.thisWeek'),
        value: useTss ? Math.round(cur.totalTss) : Math.round(cur.totalDuration / 60),
        unit: useTss ? 'TSS' : 'min',
      },
      previous: {
        label: t('insights.data.lastWeek'),
        value: useTss ? Math.round(prev.totalTss) : Math.round(prev.totalDuration / 60),
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
        iconColor: insightIcon.positive,
        title: t(upKey, { percent }),
        body,
        navigationTarget: '/insights?tab=routes',
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
        iconColor: insightIcon.caution,
        title: t(downKey, { percent }),
        body,
        navigationTarget: '/insights?tab=routes',
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
  now: number,
  t: TFunc
): Insight[] {
  if (prev.count === 0 || !chronic) return [];

  const useTss = prev.totalTss > 0 && chronic.totalTss > 0;
  const prevValue = useTss ? prev.totalTss : prev.totalDuration;
  const avgValue = useTss ? chronic.totalTss : chronic.totalDuration;

  if (avgValue <= 0 || prevValue <= 0) return [];

  const ratio = prevValue / avgValue - 1;
  const percent = Math.round(Math.abs(ratio) * 100);
  if (percent < Math.round(INSIGHTS_CONFIG.thresholds.volumeChangePct * 100)) return [];

  const direction = ratio > 0 ? t('insights.weeklyLoad.above') : t('insights.weeklyLoad.below');

  return [
    makeInsight({
      id: 'period_comparison-volume',
      category: 'period_comparison',
      priority: 2,
      icon: ratio > 0 ? 'trending-up' : 'trending-down',
      iconColor: ratio > 0 ? insightIcon.positive : insightIcon.caution,
      title: t('insights.weeklyLoad.title', { percent, direction }),
      navigationTarget: '/insights?tab=routes',
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
            value: useTss ? Math.round(prev.totalTss) : Math.round(prev.totalDuration / 60),
            unit: useTss ? 'TSS' : 'min',
          },
          previous: {
            label: t('insights.data.fourWeekAvgTss'),
            value: useTss ? Math.round(chronic.totalTss) : Math.round(chronic.totalDuration / 60),
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
