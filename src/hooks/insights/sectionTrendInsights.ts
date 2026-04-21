import { formatDuration } from '@/lib';
import type { Insight, SectionTrendData, TFunc } from './types';
import { makeInsight } from './insightBuilder';
import { INSIGHTS_CONFIG, maxAgeDaysFor, maxPerCategoryFor } from './config';

const DAY_MS = 86_400_000;

/**
 * Generate section trend insights for improving/declining sections.
 *
 * Recency: the triggering event (the declining/improving trend) must be
 * current. A section last visited months ago is not a motivating insight,
 * even if the historic trend is strong. We drop sections whose
 * `daysSinceLast` exceeds `INSIGHTS_CONFIG.activeWindowDays` here — the
 * rules-pipeline G1 gate will re-check via meta.sourceTimestamp, so this
 * local filter is a pre-selection to avoid wasting one of our 2 candidate
 * slots on a stale section.
 *
 * @param existingInsightIds - IDs of already-generated insights (to avoid duplicates)
 */
export function generateSectionTrendInsights(
  sectionTrends: SectionTrendData[],
  existingInsightIds: Set<string>,
  now: number,
  t: TFunc
): Insight[] {
  if (!sectionTrends || sectionTrends.length === 0) return [];

  const minTraversals = INSIGHTS_CONFIG.repetition.section_trend_min;
  const maxAgeDays = maxAgeDaysFor('section_trend');
  const eligible = sectionTrends.filter((s) => {
    if (s.traversalCount < minTraversals) return false;
    if (s.trend === 0) return false;
    // Recency: keep sections of unknown age (no daysSinceLast) and those
    // within the active window; drop stale ones.
    if (s.daysSinceLast != null && Number.isFinite(s.daysSinceLast)) {
      if (s.daysSinceLast > maxAgeDays) return false;
    }
    return true;
  });
  if (eligible.length === 0) return [];

  const sorted = [...eligible].sort((a, b) => {
    if (b.trend !== a.trend) return b.trend - a.trend;
    if (a.latestIsPr !== b.latestIsPr) return a.latestIsPr ? -1 : 1;
    return b.traversalCount - a.traversalCount;
  });

  const cap = maxPerCategoryFor('section_trend');
  const insights: Insight[] = [];
  for (const section of sorted) {
    if (insights.length >= cap) break;

    // Skip sections that already have a PR or stale-PR insight
    if (existingInsightIds.has(section.sectionId)) continue;

    const isImproving = section.trend === 1;
    const priority = isImproving && section.latestIsPr ? 2 : 3;

    const daysSinceLast = section.daysSinceLast;
    const sourceTimestamp =
      daysSinceLast != null && Number.isFinite(daysSinceLast)
        ? now - daysSinceLast * DAY_MS
        : undefined;

    insights.push(
      makeInsight({
        id: `section_trend-${section.sectionId}`,
        category: 'section_trend',
        priority: priority as 2 | 3,
        icon: isImproving ? 'trending-up' : 'trending-down',
        iconColor: isImproving ? '#66BB6A' : '#FFA726',
        title: isImproving
          ? t('insights.sectionImproving', { name: section.sectionName })
          : t('insights.sectionDeclining', { name: section.sectionName }),
        body: isImproving
          ? t('insights.sectionImprovingBody', {
              median: formatDuration(section.medianRecentSecs),
              best: formatDuration(section.bestTimeSecs),
              count: section.traversalCount,
            })
          : t('insights.sectionDecliningBody', {
              median: formatDuration(section.medianRecentSecs),
              best: formatDuration(section.bestTimeSecs),
              count: section.traversalCount,
            }),
        navigationTarget: `/section/${section.sectionId}`,
        timestamp: now,
        confidence: Math.min(1, section.traversalCount / 10),
        meta: {
          sourceTimestamp,
          comparisonKind: 'self',
          repetitionCount: section.traversalCount,
          specificity: {
            hasNumber: Number.isFinite(section.medianRecentSecs),
            hasPlace: Boolean(section.sectionName),
            hasDate: sourceTimestamp != null,
          },
        },
        supportingData: {
          sections: [
            {
              sectionId: section.sectionId,
              sectionName: section.sectionName,
              bestTime: section.bestTimeSecs,
              trend: section.trend,
              traversalCount: section.traversalCount,
              sportType: section.sportType,
              hasRecentPR: section.latestIsPr,
              daysSinceLast: section.daysSinceLast,
            },
          ],
          dataPoints: [
            {
              label: t('insights.data.recentMedian'),
              value: formatDuration(section.medianRecentSecs),
            },
            {
              label: t('insights.data.bestTime'),
              value: formatDuration(section.bestTimeSecs),
              context: 'good' as const,
            },
            {
              label: t('insights.data.efforts'),
              value: section.traversalCount,
            },
          ],
        },
        methodology: {
          name: t('insights.methodology.sectionTrendName'),
          description: t('insights.methodology.sectionTrend'),
        },
      })
    );
  }

  return insights;
}
