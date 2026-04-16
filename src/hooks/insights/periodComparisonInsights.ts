import type { InsightMethodology, InsightSupportingData } from '@/types';
import type { Insight, PeriodStats, TFunc } from './types';
import { makeInsight } from './insightBuilder';

const VOLUME_CHANGE_THRESHOLD = 0.15;

/** Format seconds to compact duration string (e.g., "1h30" or "45m"). */
export function formatDurationCompact(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  return `${m}m`;
}

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

  const insights: Insight[] = [];
  if (ratio > VOLUME_CHANGE_THRESHOLD) {
    insights.push(
      makeInsight({
        id: 'period_comparison-volume',
        category: 'period_comparison',
        priority: 2,
        icon: 'trending-up',
        iconColor: '#66BB6A',
        title: t(upKey, { percent }),
        body,
        navigationTarget: '/routes?tab=routes',
        timestamp: now,
        methodology: comparisonMethodology,
        supportingData: comparisonSupportingData,
      })
    );
  } else if (ratio < -VOLUME_CHANGE_THRESHOLD) {
    insights.push(
      makeInsight({
        id: 'period_comparison-volume',
        category: 'period_comparison',
        priority: 2,
        icon: 'trending-down',
        iconColor: '#FFA726',
        title: t(downKey, { percent }),
        body,
        navigationTarget: '/routes?tab=routes',
        timestamp: now,
        methodology: comparisonMethodology,
        supportingData: comparisonSupportingData,
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
  if (percent < Math.round(VOLUME_CHANGE_THRESHOLD * 100)) return [];

  const direction = ratio > 0 ? t('insights.weeklyLoad.above') : t('insights.weeklyLoad.below');

  return [
    makeInsight({
      id: 'period_comparison-volume',
      category: 'period_comparison',
      priority: 2,
      icon: ratio > 0 ? 'trending-up' : 'trending-down',
      iconColor: ratio > 0 ? '#66BB6A' : '#FFA726',
      title: t('insights.weeklyLoad.title', { percent, direction }),
      navigationTarget: '/routes?tab=routes',
      timestamp: now,
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
