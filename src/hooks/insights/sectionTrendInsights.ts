import type { Insight, InsightMethodology, InsightSupportingData } from '@/types';
import { formatDuration } from '@/lib';

interface SectionTrendData {
  sectionId: string;
  sectionName: string;
  trend: number; // -1=declining, 0=stable, 1=improving
  medianRecentSecs: number;
  bestTimeSecs: number;
  traversalCount: number;
  sportType?: string;
  daysSinceLast?: number;
  latestIsPr?: boolean;
}

type TFunc = (key: string, params?: Record<string, string | number>) => string;

const MAX_SECTION_TREND_INSIGHTS = 2;
const MIN_TREND_TRAVERSALS = 3;

function makeInsight(fields: {
  id: string;
  category: Insight['category'];
  priority: Insight['priority'];
  icon: string;
  iconColor: string;
  title: string;
  body?: string;
  navigationTarget?: string;
  timestamp: number;
  confidence?: number;
  supportingData?: InsightSupportingData;
  methodology?: InsightMethodology;
}): Insight {
  return { ...fields, isNew: false } as Insight;
}

/**
 * Generate section trend insights for improving/declining sections.
 * @param existingInsightIds - IDs of already-generated insights (to avoid duplicates)
 */
export function generateSectionTrendInsights(
  sectionTrends: SectionTrendData[],
  existingInsightIds: Set<string>,
  now: number,
  t: TFunc
): Insight[] {
  if (!sectionTrends || sectionTrends.length === 0) return [];

  const eligible = sectionTrends.filter(
    (s) => s.traversalCount >= MIN_TREND_TRAVERSALS && s.trend !== 0
  );
  if (eligible.length === 0) return [];

  const sorted = [...eligible].sort((a, b) => {
    if (b.trend !== a.trend) return b.trend - a.trend;
    if (a.latestIsPr !== b.latestIsPr) return a.latestIsPr ? -1 : 1;
    return b.traversalCount - a.traversalCount;
  });

  const insights: Insight[] = [];
  for (const section of sorted) {
    if (insights.length >= MAX_SECTION_TREND_INSIGHTS) break;

    // Skip sections that already have a PR or stale-PR insight
    if (existingInsightIds.has(section.sectionId)) continue;

    const isImproving = section.trend === 1;
    const priority = isImproving && section.latestIsPr ? 2 : 3;

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
