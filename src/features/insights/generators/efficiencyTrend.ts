import { EfficiencyDirection, type EfficiencyTrend } from 'veloqrs';

import type { Insight } from '../types';
import { INSIGHTS_CONFIG, confidenceFrom, maxPerCategoryFor } from '../lib/config';
import { sparkline } from '../lib/sparkline';

/**
 * The slope to three significant figures, which is what the regression over a
 * handful of efforts supports, and never in exponent notation: below a
 * thousandth of a unit a day it reads as no change.
 */
function formatSlope(slope: number): string {
  if (!Number.isFinite(slope) || Math.abs(slope) < 0.001) return '0';
  return String(Number(slope.toPrecision(3)));
}

/**
 * Aerobic Efficiency Trend Insights
 *
 * Detects changes in aerobic efficiency on frequently visited sections by
 * analysing heart rate per unit of speed over time. A lower ratio means less
 * cardiac cost at the same speed.
 *
 * Evidence base:
 * Coyle, E. F. et al. (1991). Time course of loss of adaptations after
 *   stopping prolonged intense endurance training. J Appl Physiol, 71(4).
 * Jones, A. M. & Carter, H. (2000). The effect of endurance training on
 *   parameters of aerobic fitness. Sports Med, 29(6), 373–386.
 *
 * Data source: the engine's insights bundle, which computes linear regression
 * of that ratio over matched efforts and returns only the sections that
 * cleared a directional, effort-count and HR-change threshold. Sections
 * without sufficient HR data never reach here.
 */

// Translation function type
type TFunc = (key: string, params?: Record<string, string | number>) => string;

/**
 * Generate aerobic efficiency trend insights from the engine's trends.
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
  const quantity = t('insights.efficiencyTrend.quantity');
  const unit = t('units.bpmSecondsPerKm');
  // The slope is the ratio's change per day of the window.
  const slopeUnit = `${unit}/d`;

  const ordered = [...trends].sort(
    (a, b) =>
      Number(a.direction !== EfficiencyDirection.Improving) -
      Number(b.direction !== EfficiencyDirection.Improving)
  );
  for (const trend of ordered) {
    if (insights.length >= cap) break;

    const declining = trend.direction === EfficiencyDirection.Worsening;
    const floor = declining
      ? INSIGHTS_CONFIG.repetition.efficiency_trend_declining_min
      : minEfforts;
    if (trend.direction === EfficiencyDirection.Flat || trend.effortCount < floor) continue;

    const hrChange = Math.abs(Math.round(trend.hrChangeBpm));
    const firstEffort = trend.points[0];
    const lastEffort = trend.points[trend.points.length - 1];

    insights.push({
      id: `efficiency_trend-${trend.sectionId}-${trend.sportType}`,
      category: 'efficiency_trend',
      priority: 1,
      icon: 'heart-pulse',
      iconTone: declining ? 'neutral' : 'positive',
      title: t(
        declining ? 'insights.efficiencyTrend.changeTitle' : 'insights.efficiencyTrend.title',
        {
          name: trend.sectionName,
          hrChange,
        }
      ),
      subtitle: t(
        declining ? 'insights.efficiencyTrend.changeSubtitle' : 'insights.efficiencyTrend.subtitle',
        {
          hrChange,
          efforts: trend.effortCount,
        }
      ),
      body: t(declining ? 'insights.efficiencyTrend.changeBody' : 'insights.efficiencyTrend.body', {
        name: trend.sectionName,
        efforts: trend.effortCount,
        hrChange,
      }),
      navigationTarget: `/section/${trend.sectionId}`,
      timestamp: now,
      isNew: false,
      confidence: confidenceFrom('efficiency_trend', trend.effortCount),
      meta: {
        sourceTimestamp: now,
        comparisonKind: 'self',
        repetitionCount: trend.effortCount,
        placeName: trend.sectionName,
        sectionId: trend.sectionId,
        // The newest effort against the mean of its own series, taken where
        // the series is built rather than averaged again here.
        signalDelta: trend.signalDelta,
      },
      supportingData: {
        ...sparkline(
          trend.points.map((point) => ({ date: point.date, value: point.hrPaceRatio })),
          t('insights.efficiencyTrend.seriesLabel', { quantity }),
          `/section/${trend.sectionId}`,
          {
            unit,
            mark:
              firstEffort && lastEffort
                ? { from: firstEffort.date, to: lastEffort.date }
                : undefined,
            format: (ratio) => `${Math.round(ratio)} ${unit}`,
          }
        ),
        // The ratio is heart rate times pace, so its slope and the engine's
        // direction describe the same movement.
        trend: {
          direction: trend.trendSlope < 0 ? 'down' : trend.trendSlope > 0 ? 'up' : 'flat',
          verdict: declining ? 'declined' : 'improved',
        },
        dataPoints: [
          {
            key: 'hrChange',
            label: t('insights.data.hrChange'),
            value: `${declining ? '+' : '-'}${hrChange}`,
            unit: 'bpm',
            context: declining ? ('neutral' as const) : ('good' as const),
          },
          {
            key: 'effortCount',
            label: t('insights.data.efforts'),
            value: trend.effortCount,
          },
          {
            label: t('insights.data.trendSlope'),
            value: formatSlope(trend.trendSlope),
            unit: slopeUnit,
            context: 'neutral' as const,
          },
        ],
        sections: [
          {
            sectionId: trend.sectionId,
            sectionName: trend.sectionName,
            sportType: trend.sportType,
          },
        ],
      },
      methodology: {
        name: t('insights.methodology.efficiencyName'),
        description: t('insights.methodology.efficiencyDescription'),
        formula: t('insights.methodology.efficiencyFormula', { quantity, unit }),
      },
    });
  }

  return insights;
}
