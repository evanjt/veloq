import type { Insight } from '@/types';
import { getRouteEngine } from '@/lib/native/routeEngine';

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
 * Data source: getSectionEfficiencyTrend(sectionId) from the Rust engine,
 * which computes linear regression of HR/pace ratio over matched efforts.
 * Returns null for sections without sufficient HR data — the insight simply
 * does not appear until HR data exists.
 */

// Translation function type
type TFunc = (key: string, params?: Record<string, string | number>) => string;

/** Maximum efficiency trend insights to generate */
const MAX_EFFICIENCY_INSIGHTS = 2;

/**
 * Generate aerobic efficiency trend insights from the top-ranked sections.
 *
 * @param sectionIds - Section IDs to check (from getRankedSections or similar)
 * @param now - Current timestamp for the insight
 * @param t - Translation function
 * @returns Array of efficiency trend insights (may be empty)
 */
export function generateEfficiencyTrendInsights(
  sectionIds: string[],
  now: number,
  t: TFunc
): Insight[] {
  const engine = getRouteEngine();
  if (!engine || sectionIds.length === 0) return [];
  if (typeof engine.getSectionEfficiencyTrend !== 'function') return [];

  const insights: Insight[] = [];

  for (const sectionId of sectionIds) {
    if (insights.length >= MAX_EFFICIENCY_INSIGHTS) break;

    const trend = engine.getSectionEfficiencyTrend(sectionId);
    if (!trend || !trend.isImproving || trend.effortCount < 3) continue;

    const hrChange = Math.abs(Math.round(trend.hrChangeBpm));
    if (hrChange < 1) continue;

    insights.push({
      id: `efficiency_trend-${trend.sectionId}`,
      category: 'efficiency_trend',
      priority: 1,
      icon: 'heart-pulse',
      iconColor: '#66BB6A',
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
