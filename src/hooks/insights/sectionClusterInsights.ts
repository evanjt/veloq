import type { Insight, InsightSupportingData, InsightMethodology } from '@/types';

/**
 * Section Cluster Insights
 *
 * Groups sections by sport type and trend direction (improving / declining /
 * stable) and generates aggregate insights when 2+ sections share the same
 * trend within a sport.
 *
 * This is a TypeScript-side approximation of geographic clustering: instead
 * of using spatial R-tree grouping (future Rust implementation), we group
 * sections by their performance trend similarity.
 *
 * Framed as observation, not advice:
 * - Improving: "3 running sections improving" with names
 * - Declining: "2 cycling sections to revisit" (positive framing, never punitive)
 * - Stable: not surfaced (no actionable signal)
 */

// ---------------------------------------------------------------------------
// Input types — mirrors SectionTrendData from generateInsights.ts
// ---------------------------------------------------------------------------

export interface SectionTrendData {
  sectionId: string;
  sectionName: string;
  trend: number; // -1=declining, 0=stable, 1=improving
  medianRecentSecs: number;
  bestTimeSecs: number;
  traversalCount: number;
  sportType?: string; // 'Run', 'Ride', 'Swim', etc.
  daysSinceLast?: number; // days since last traversal
}

// Translation function type
type TFunc = (key: string, params?: Record<string, string | number>) => string;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum sections in a cluster to generate an insight */
const MIN_CLUSTER_SIZE = 2;

/** Maximum cluster insights to return */
const MAX_CLUSTER_INSIGHTS = 2;

/** Maximum section names to list in the body text */
const MAX_LISTED_NAMES = 5;

// ---------------------------------------------------------------------------
// Sport type display mapping
// ---------------------------------------------------------------------------

/** Map intervals.icu sport type codes to lowercase display names */
const SPORT_DISPLAY: Record<string, string> = {
  Run: 'running',
  Ride: 'cycling',
  Swim: 'swimming',
  VirtualRide: 'cycling',
  VirtualRun: 'running',
};

/** Get lowercase sport display name, empty string for unknown types */
export function getSportDisplayName(sportType?: string): string {
  if (!sportType) return '';
  return SPORT_DISPLAY[sportType] ?? '';
}

// ---------------------------------------------------------------------------
// Generation logic
// ---------------------------------------------------------------------------

/**
 * Generate cluster insights from section trend data.
 *
 * Groups by sport type first, then by trend within each sport. Returns up to
 * MAX_CLUSTER_INSIGHTS insights, prioritising improving clusters.
 *
 * Stable sections are not surfaced (no actionable signal).
 */
export function generateSectionClusterInsights(
  sectionTrends: SectionTrendData[],
  now: number,
  t: TFunc
): Insight[] {
  if (!sectionTrends || sectionTrends.length === 0) return [];

  // Group sections by sport type
  const bySport = new Map<string, SectionTrendData[]>();
  for (const s of sectionTrends) {
    const sport = s.sportType ?? '';
    const list = bySport.get(sport);
    if (list) {
      list.push(s);
    } else {
      bySport.set(sport, [s]);
    }
  }

  const insights: Insight[] = [];

  // Process each sport group: improving first, then declining
  for (const [sport, sections] of bySport) {
    const improving = sections.filter((s) => s.trend === 1);
    const declining = sections.filter((s) => s.trend === -1);

    if (improving.length >= MIN_CLUSTER_SIZE) {
      insights.push(makeClusterInsight(improving, 'improving', sport, now, t));
    }
    if (declining.length >= MIN_CLUSTER_SIZE) {
      insights.push(makeClusterInsight(declining, 'declining', sport, now, t));
    }
  }

  // Sort: improving before declining, then by section count descending
  insights.sort((a, b) => {
    const aIsImproving = a.id.includes('improving') ? 1 : 0;
    const bIsImproving = b.id.includes('improving') ? 1 : 0;
    if (aIsImproving !== bIsImproving) return bIsImproving - aIsImproving;
    return (b.supportingData?.sections?.length ?? 0) - (a.supportingData?.sections?.length ?? 0);
  });

  return insights.slice(0, MAX_CLUSTER_INSIGHTS);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClusterInsight(
  sections: SectionTrendData[],
  direction: 'improving' | 'declining',
  sportType: string,
  now: number,
  t: TFunc
): Insight {
  // Sort by recency (most recently done first), then traversal count as tiebreaker
  const sorted = [...sections].sort((a, b) => {
    const aDays = a.daysSinceLast ?? Infinity;
    const bDays = b.daysSinceLast ?? Infinity;
    if (aDays !== bDays) return aDays - bDays;
    return b.traversalCount - a.traversalCount;
  });
  const names = sorted.slice(0, MAX_LISTED_NAMES).map((s) => s.sectionName);
  const nameList = names.join(', ');
  const count = sections.length;
  const sport = getSportDisplayName(sportType);

  const isImproving = direction === 'improving';

  const supportingData: InsightSupportingData = {
    sections: sorted.map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      bestTime: s.bestTimeSecs,
      trend: s.trend,
      traversalCount: s.traversalCount,
      sportType: s.sportType,
      daysSinceLast: s.daysSinceLast,
    })),
    algorithmDescription: t('insights.sectionCluster.methodology'),
  };

  const methodology: InsightMethodology = {
    name: 'Trend-based section clustering',
    description: t('insights.sectionCluster.methodology'),
  };

  // Use sport-specific ID to allow one insight per sport per direction
  const sportSuffix = sportType ? `-${sportType.toLowerCase()}` : '';

  // Name the top section in the title instead of a generic count
  const topSectionName = sorted[0].sectionName;
  const otherCount = count - 1;

  return {
    id: `section_cluster-${direction}${sportSuffix}`,
    category: 'section_cluster',
    priority: 3,
    icon: isImproving ? 'trending-up' : 'map-marker-path',
    iconColor: isImproving ? '#66BB6A' : '#FFA726',
    title: isImproving
      ? t('insights.sectionCluster.improvingTitle', { name: topSectionName })
      : t('insights.sectionCluster.decliningTitle', { name: topSectionName }),
    subtitle:
      otherCount > 0
        ? t('insights.sectionCluster.subtitle', { count: otherCount, sport })
        : undefined,
    body: isImproving
      ? t('insights.sectionCluster.improvingBody', { names: nameList, count })
      : t('insights.sectionCluster.decliningBody', {
          names: nameList,
          count,
        }),
    navigationTarget: '/routes',
    timestamp: now,
    isNew: false,
    supportingData,
    methodology,
  };
}
