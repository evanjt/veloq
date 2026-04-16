import type { Insight, TFunc } from './types';
import { makeInsight } from './insightBuilder';

const MIN_HRV_DATA_POINTS = 5;

/**
 * HRV Trend Insight
 * Kiviniemi et al., 2007 — HRV-guided training RCT
 */
export function generateHrvTrendInsight(
  wellnessWindow: Array<{ date: string; hrv?: number }> | undefined,
  now: number,
  t: TFunc
): Insight[] {
  const window = wellnessWindow ?? [];
  const hrvValues = window.filter((w) => typeof w.hrv === 'number' && w.hrv > 0);

  if (hrvValues.length < MIN_HRV_DATA_POINTS) return [];

  const hrvNums = hrvValues.map((w) => w.hrv as number);
  const avg = hrvNums.reduce((s, v) => s + v, 0) / hrvNums.length;
  if (avg <= 0) return [];

  const firstHalf = hrvNums.slice(0, Math.floor(hrvNums.length / 2));
  const secondHalf = hrvNums.slice(Math.floor(hrvNums.length / 2));
  const firstAvg =
    firstHalf.length > 0 ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const secondAvg =
    secondHalf.length > 0 ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;

  // Check for 2 consecutive days of decline (Kiviniemi protocol threshold)
  const lastTwo = hrvNums.slice(-2);
  const consecutiveDecline = lastTwo.length === 2 && lastTwo[0] > lastTwo[1] && lastTwo[1] < avg;

  let trendKey: string;
  let trendColor: string;
  let trendIcon: string;

  if (secondAvg > firstAvg * 1.02) {
    trendKey = 'trendingUp';
    trendColor = '#66BB6A';
    trendIcon = 'trending-up';
  } else if (consecutiveDecline || secondAvg < firstAvg * 0.98) {
    trendKey = 'trendingDown';
    trendColor = '#FFA726';
    trendIcon = 'trending-down';
  } else {
    trendKey = 'stable';
    trendColor = '#42A5F5';
    trendIcon = 'minus';
  }

  const confidence = Math.min(1, hrvValues.length / 7);

  return [
    makeInsight({
      id: 'hrv_trend',
      category: 'hrv_trend',
      priority: 2,
      icon: trendIcon,
      iconColor: trendColor,
      title: t(`insights.hrvTrend.${trendKey}`),
      body: t(`insights.hrvTrend.${trendKey}Body`, {
        avg: Math.round(avg),
        days: hrvValues.length,
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      confidence,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.sevenDayAvg'),
            value: Math.round(avg),
            unit: 'ms',
            context: 'neutral',
          },
          {
            label: t('insights.data.latestHrv'),
            value: Math.round(hrvNums[hrvNums.length - 1]),
            unit: 'ms',
            context: 'neutral',
          },
          {
            label: t('insights.data.dataPoints'),
            value: hrvValues.length,
            unit: t('insights.data.days'),
          },
        ],
        sparklineData: hrvNums,
        sparklineLabel: t('insights.data.hrvSevenDay'),
      },
      methodology: {
        name: t('insights.methodology.hrvName'),
        description: t('insights.methodology.hrvDescription'),
      },
    }),
  ];
}
