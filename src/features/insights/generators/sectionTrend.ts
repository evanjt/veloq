import type { Insight, SectionTrendData, SupportingSection, TFunc } from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { confidenceFrom, maxAgeDaysFor } from '../lib/config';
import { sectionPairKey } from '../lib/sectionIdentity';

const DAY_MS = 86_400_000;

function fallbackEligible(
  trends: SectionTrendData[],
  coveredPairs: Set<string>
): SectionTrendData[] {
  const maxAgeDays = maxAgeDaysFor('section_trend');
  return trends.filter((section) => {
    if (section.trend === 0) return false;
    if (coveredPairs.has(sectionPairKey(section.sectionId, section.sportType))) return false;
    return section.daysSinceLast == null || section.daysSinceLast <= maxAgeDays;
  });
}

function supportingSections(trends: SectionTrendData[]): SupportingSection[] {
  return trends.map((section) => ({
    sectionId: section.sectionId,
    sectionName: section.sectionName,
    bestTime: section.bestTimeSecs,
    trend: section.trend,
    traversalCount: section.traversalCount,
    sportType: section.sportType,
    hasRecentPR: section.latestIsPr,
    daysSinceLast: section.daysSinceLast,
    ranking: section.ranking,
  }));
}

export interface SectionTrendCounts {
  faster: number;
  slower: number;
}

/** One summary whose rows retain every eligible section and sport. */
export function generateSectionTrendInsights(
  sectionTrends: SectionTrendData[],
  coveredPairs: Set<string>,
  now: number,
  t: TFunc,
  engineCounts?: SectionTrendCounts
): Insight[] {
  const sections = engineCounts
    ? [...sectionTrends]
    : fallbackEligible(sectionTrends, coveredPairs);
  sections.sort(
    (a, b) =>
      (b.ranking?.relevance ?? 0) - (a.ranking?.relevance ?? 0) ||
      b.traversalCount - a.traversalCount
  );
  const [best] = sections;
  if (!best) return [];
  const faster = engineCounts?.faster ?? sections.filter((section) => section.trend > 0).length;
  const slower = engineCounts?.slower ?? sections.filter((section) => section.trend < 0).length;
  const newestAge = sections.reduce(
    (age, section) => Math.min(age, section.daysSinceLast ?? 0),
    Infinity
  );

  return [
    makeInsight({
      id: 'section_trend-summary',
      category: 'section_trend',
      priority: 3,
      icon: faster >= slower ? 'trending-up' : 'trending-down',
      iconTone: faster >= slower ? 'positive' : 'negative',
      title: t('insights.sectionTrendSummary', {
        faster: t('insights.sectionTrendFaster', { count: faster }),
        slower: t('insights.sectionTrendSlower', { count: slower }),
      }),
      timestamp: now,
      confidence: confidenceFrom('section_trend', best.traversalCount),
      meta: {
        sourceTimestamp: now - newestAge * DAY_MS,
        comparisonKind: 'self',
        repetitionCount: best.traversalCount,
      },
      supportingData: { sections: supportingSections(sections) },
      methodology: {
        name: t('insights.methodology.sectionTrendName'),
        description: t('insights.methodology.sectionTrend'),
      },
    }),
  ];
}
