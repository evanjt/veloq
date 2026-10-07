import type { Insight, TFunc } from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { confidenceFrom } from '../lib/config';
import type { InsightTone } from '@/theme';
import { fitnessTarget, rangeCovering } from '@/shared/app/fitnessEntry';

interface TrendShape {
  label: string; // "trendingUp" | "stable" | "trendingDown"
  /** Which rule produced `label`: "halves" or "lastTwoDays". */
  reason?: string;
  avg: number;
  latest: number;
  dataPoints: number;
  sparkline: { value: number }[];
  signalDelta?: number;
}

/**
 * HRV Trend Insight
 * Kiviniemi et al., 2007 - HRV-guided training RCT
 *
 * The verdict is the engine's, over the window the insights bundle carried it
 * on. There is no TS copy of the maths: one deadband, one place. It used to be
 * read here with an engine call of its own, on top of the heaviest read in the
 * tree.
 */
export function generateHrvTrendInsight(
  trend: TrendShape | null | undefined,
  now: number,
  t: TFunc
): Insight[] {
  if (!trend) return [];

  const trendKey = trend.label; // "trendingUp" | "stable" | "trendingDown"

  let trendTone: InsightTone;
  let trendIcon: string;
  if (trendKey === 'trendingUp') {
    trendTone = 'positive';
    trendIcon = 'trending-up';
  } else if (trendKey === 'trendingDown') {
    // A fall in HRV is a judgement on what already happened, not a warning
    // about what comes next, so it is the negative rung and not caution.
    trendTone = 'negative';
    trendIcon = 'trending-down';
  } else {
    trendTone = 'info';
    trendIcon = 'minus';
  }

  const confidence = confidenceFrom('hrv_trend', trend.dataPoints);

  return [
    makeInsight({
      id: 'hrv_trend',
      category: 'hrv_trend',
      priority: 2,
      icon: trendIcon,
      iconTone: trendTone,
      title: t(
        trend.reason === 'lastTwoDays'
          ? 'insights.hrvTrend.lastTwoDays'
          : `insights.hrvTrend.${trendKey}`
      ),
      // Two rules end in `trendingDown` and they are different claims, so the
      // body says which one fired rather than reporting a falling average
      // over a window whose average did not fall.
      body: t(
        trend.reason === 'lastTwoDays'
          ? 'insights.hrvTrend.lastTwoDaysBody'
          : `insights.hrvTrend.${trendKey}Body`,
        {
          avg: Math.round(trend.avg),
          days: trend.dataPoints,
          latest: Math.round(trend.latest),
        }
      ),
      // The verdict is a trailing window, so the tab opens on the narrowest
      // range that holds it rather than on its own six months.
      navigationTarget: fitnessTarget({ range: rangeCovering(trend.dataPoints) }),
      timestamp: now,
      confidence,
      meta: {
        sourceTimestamp: now,
        comparisonKind: 'self',
        // The window the verdict was read over is the spread the latest day is
        // measured against, so the ranker can tell a move from a wobble. The
        // engine reads it off the same window it took the verdict from.
        signalDelta: trend.signalDelta,
      },
      supportingData: {
        dataPoints: [
          {
            key: 'hrvAverage',
            label: t('insights.data.sevenDayAvg'),
            value: Math.round(trend.avg),
            unit: 'ms',
            context: 'neutral',
          },
          {
            key: 'hrvLatest',
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
        sparklineData: trend.sparkline.map((point) => point.value),
        sparklineLabel: t('insights.data.hrvSevenDay'),
      },
      methodology: {
        name: t('insights.methodology.hrvName'),
        description: t('insights.methodology.hrvDescription'),
      },
    }),
  ];
}
