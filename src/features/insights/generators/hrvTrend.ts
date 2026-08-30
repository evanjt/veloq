import type { Insight, TFunc } from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { insightIcon } from '@/theme';

const HRV_WINDOW_DAYS = 7;

interface TrendShape {
  label: string; // "trendingUp" | "stable" | "trendingDown"
  avg: number;
  latest: number;
  dataPoints: number;
  sparkline: number[];
}

/**
 * HRV Trend Insight
 * Kiviniemi et al., 2007 - HRV-guided training RCT
 *
 * The verdict comes from `engine.computeHrvTrend` (Rust SQLite). There is no
 * TS copy of the maths: one deadband, one place.
 */
export function generateHrvTrendInsight(now: number, t: TFunc): Insight[] {
  let trend: TrendShape | null = null;
  try {
    const engine = getRouteEngine();
    if (engine?.computeHrvTrend) {
      trend = engine.computeHrvTrend(HRV_WINDOW_DAYS);
    }
  } catch {
    trend = null;
  }
  if (!trend) return [];

  const trendKey = trend.label; // "trendingUp" | "stable" | "trendingDown"

  let trendColor: string;
  let trendIcon: string;
  if (trendKey === 'trendingUp') {
    trendColor = insightIcon.positive;
    trendIcon = 'trending-up';
  } else if (trendKey === 'trendingDown') {
    trendColor = insightIcon.caution;
    trendIcon = 'trending-down';
  } else {
    trendColor = insightIcon.info;
    trendIcon = 'minus';
  }

  const confidence = Math.min(1, trend.dataPoints / 7);

  return [
    makeInsight({
      id: 'hrv_trend',
      category: 'hrv_trend',
      priority: 2,
      icon: trendIcon,
      iconColor: trendColor,
      title: t(`insights.hrvTrend.${trendKey}`),
      body: t(`insights.hrvTrend.${trendKey}Body`, {
        avg: Math.round(trend.avg),
        days: trend.dataPoints,
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      confidence,
      meta: {
        sourceTimestamp: now,
        comparisonKind: 'self',
        specificity: { hasNumber: true, hasPlace: false, hasDate: true },
      },
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.sevenDayAvg'),
            value: Math.round(trend.avg),
            unit: 'ms',
            context: 'neutral',
          },
          {
            label: t('insights.data.latestHrv'),
            value: Math.round(trend.latest),
            unit: 'ms',
            context: 'neutral',
          },
          {
            label: t('insights.data.dataPoints'),
            value: trend.dataPoints,
            unit: t('insights.data.days'),
          },
        ],
        sparklineData: trend.sparkline,
        sparklineLabel: t('insights.data.hrvSevenDay'),
      },
      methodology: {
        name: t('insights.methodology.hrvName'),
        description: t('insights.methodology.hrvDescription'),
      },
    }),
  ];
}
