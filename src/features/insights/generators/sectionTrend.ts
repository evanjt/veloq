import type {
  HistoryChange,
  Insight,
  InsightHistory,
  SectionTrendData,
  SupportingSection,
  TFunc,
} from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { confidenceFrom, maxAgeDaysFor } from '../lib/config';
import { sectionPairKey } from '../lib/sectionIdentity';
import { TIME } from '@/shared/app/time';

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

/**
 * Each section's signed change as the engine measured it, in the rows' order.
 * A section the engine compared nothing on has no change and draws no bar,
 * rather than a bar at zero.
 */
function sectionChanges(sections: SectionTrendData[]): InsightHistory | undefined {
  const bars: HistoryChange[] = [];
  for (const section of sections) {
    const change = section.ranking?.improvementChange;
    if (change != null && Number.isFinite(change)) {
      bars.push({ key: section.sectionId, value: change });
    }
  }
  return bars.length > 0 ? { kind: 'changes', bars } : undefined;
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
  const history = sectionChanges(sections);
  const counts = {
    faster: t('insights.sectionTrendFaster', { count: faster }),
    slower: t('insights.sectionTrendSlower', { count: slower }),
  };

  return [
    makeInsight({
      id: 'section_trend-summary',
      category: 'section_trend',
      priority: 3,
      icon: faster >= slower ? 'trending-up' : 'trending-down',
      iconTone: faster >= slower ? 'positive' : 'negative',
      title: t('insights.sectionTrendSummary', counts),
      line: t('insights.line.sectionTrend', counts),
      timestamp: now,
      confidence: confidenceFrom('section_trend', best.traversalCount),
      meta: {
        sourceTimestamp: now - newestAge * TIME.DAY,
        comparisonKind: 'self',
        repetitionCount: best.traversalCount,
      },
      supportingData: {
        sections: supportingSections(sections),
        ...(history ? { history } : {}),
      },
      methodology: {
        name: t('insights.methodology.sectionTrendName'),
        description: t('insights.methodology.sectionTrend'),
      },
    }),
  ];
}
