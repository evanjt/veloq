import type { Insight, TFunc } from './types';
import { makeInsight } from './insightBuilder';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { INSIGHTS_CONFIG } from './config';

const HRV_WINDOW_DAYS = 7;

interface TrendShape {
  label: string; // "trendingUp" | "stable" | "trendingDown"
  avg: number;
  latest: number;
  dataPoints: number;
  sparkline: number[];
}

/**
 * Fallback TS implementation of the HRV trend math (Kiviniemi 2007).
 * Used when the Rust engine hasn't been initialized yet or hasn't
 * persisted wellness (e.g. jest tests). Mirrors `compute_hrv_trend`
 * in `persistence/wellness.rs` — keep in sync with that logic.
 */
function computeHrvTrendFromWindow(
  wellnessWindow: Array<{ date: string; hrv?: number }> | undefined
): TrendShape | null {
  const window = wellnessWindow ?? [];
  const hrvValues = window
    .map((w) => w.hrv)
    .filter((v): v is number => typeof v === 'number' && v > 0);

  if (hrvValues.length < INSIGHTS_CONFIG.thresholds.minHrvDataPoints) return null;

  const avg = hrvValues.reduce((s, v) => s + v, 0) / hrvValues.length;
  if (avg <= 0) return null;

  const mid = Math.floor(hrvValues.length / 2);
  const firstHalf = hrvValues.slice(0, mid);
  const secondHalf = hrvValues.slice(mid);
  const firstAvg =
    firstHalf.length > 0 ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const secondAvg =
    secondHalf.length > 0 ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;

  const lastTwo = hrvValues.slice(-2);
  const consecutiveDecline = lastTwo.length === 2 && lastTwo[0] > lastTwo[1] && lastTwo[1] < avg;

  let label: string;
  if (secondAvg > firstAvg * 1.02) label = 'trendingUp';
  else if (consecutiveDecline || secondAvg < firstAvg * 0.98) label = 'trendingDown';
  else label = 'stable';

  return {
    label,
    avg,
    latest: hrvValues[hrvValues.length - 1],
    dataPoints: hrvValues.length,
    sparkline: hrvValues,
  };
}

/**
 * HRV Trend Insight
 * Kiviniemi et al., 2007 — HRV-guided training RCT
 *
 * Primary path: reads from `engine.computeHrvTrend` (Rust SQLite).
 * Fallback path: computes from the passed-in `wellnessWindow` when the
 * engine is unavailable (tests, pre-sync startup). Both paths produce
 * identical output by construction.
 */
export function generateHrvTrendInsight(
  wellnessWindow: Array<{ date: string; hrv?: number }> | undefined,
  now: number,
  t: TFunc
): Insight[] {
  let trend: TrendShape | null = null;
  try {
    const engine = getRouteEngine();
    if (engine?.computeHrvTrend) {
      trend = engine.computeHrvTrend(HRV_WINDOW_DAYS);
    }
  } catch {
    trend = null;
  }
  if (!trend) {
    trend = computeHrvTrendFromWindow(wellnessWindow);
  }
  if (!trend) return [];

  const trendKey = trend.label; // "trendingUp" | "stable" | "trendingDown"

  let trendColor: string;
  let trendIcon: string;
  if (trendKey === 'trendingUp') {
    trendColor = '#66BB6A';
    trendIcon = 'trending-up';
  } else if (trendKey === 'trendingDown') {
    trendColor = '#FFA726';
    trendIcon = 'trending-down';
  } else {
    trendColor = '#42A5F5';
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
