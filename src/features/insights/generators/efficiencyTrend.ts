import type { EfficiencyTrend } from 'veloqrs';

import type { Insight } from '../types';
import { INSIGHTS_CONFIG, maxPerCategoryFor } from '../lib/config';
import { insightIcon } from '@/theme';

/**
 * Aerobic Efficiency Trend Insights
 *
 * Detects improving aerobic efficiency on frequently-visited sections by
 * analysing the HR/pace ratio over time. A declining ratio (lower HR at the
 * same pace) indicates physiological adaptation.
 *
 * Evidence base:
 * Coyle, E. F. et al. (1991). Time course of loss of adaptations after
 *   stopping prolonged intense endurance training. J Appl Physiol, 71(4).
 * Jones, A. M. & Carter, H. (2000). The effect of endurance training on
 *   parameters of aerobic fitness. Sports Med, 29(6), 373–386.
 *
 * Data source: the engine's insights bundle, which computes linear regression
 * of HR/pace ratio over matched efforts and returns only the sections that
 * cleared the improvement, effort-count and HR-change thresholds. Sections
 * without sufficient HR data never reach here.
 */

// Translation function type
type TFunc = (key: string, params?: Record<string, string | number>) => string;

/**
 * Generate aerobic efficiency trend insights from the engine's trends.
 *
 * @param trends - Efficiency trends from the insights bundle
 * @param now - Current timestamp for the insight
 * @param t - Translation function
 * @returns Array of efficiency trend insights (may be empty)
 */
export function generateEfficiencyTrendInsights(
  trends: EfficiencyTrend[],
  now: number,
  t: TFunc
): Insight[] {
  if (trends.length === 0) return [];

  const cap = maxPerCategoryFor('efficiency_trend');
  const minEfforts = INSIGHTS_CONFIG.repetition.efficiency_trend_min;
  const insights: Insight[] = [];

  for (const trend of trends) {
    if (insights.length >= cap) break;

    if (!trend.isImproving || trend.effortCount < minEfforts) continue;

    const hrChange = Math.abs(Math.round(trend.hrChangeBpm));
    if (hrChange < 1) continue;

    insights.push({
      id: `efficiency_trend-${trend.sectionId}`,
      category: 'efficiency_trend',
      priority: 1,
      icon: 'heart-pulse',
      iconColor: insightIcon.positive,
      title: t('insights.efficiencyTrend.title', { name: trend.sectionName }),
      subtitle: t('insights.efficiencyTrend.subtitle', {
        hrChange,
        efforts: trend.effortCount,
      }),
      body: t('insights.efficiencyTrend.body', {
        name: trend.sectionName,
        efforts: trend.effortCount,
        hrChange,
      }),
      navigationTarget: `/section/${trend.sectionId}`,
      timestamp: now,
      isNew: false,
      meta: {
        sourceTimestamp: now,
        comparisonKind: 'self',
        repetitionCount: trend.effortCount,
        specificity: {
          hasNumber: hrChange > 0,
          hasPlace: Boolean(trend.sectionName),
          hasDate: false,
        },
      },
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.hrChange'),
            value: `-${hrChange}`,
            unit: 'bpm',
            context: 'good' as const,
          },
          {
            label: t('insights.data.efforts'),
            value: trend.effortCount,
          },
          {
            label: t('insights.data.trendSlope'),
            value: trend.trendSlope.toFixed(4),
            context: 'neutral' as const,
          },
        ],
        sections: [
          {
            sectionId: trend.sectionId,
            sectionName: trend.sectionName,
          },
        ],
      },
      methodology: {
        name: 'Aerobic efficiency regression',
        description:
          'Tracks the HR/pace ratio across matched section efforts over time. Uses ordinary least squares linear regression on the hr_pace_ratio time series.',
        formula: 'efficiency = avg_hr / pace_secs_per_km',
      },
    });
  }

  return insights;
}
