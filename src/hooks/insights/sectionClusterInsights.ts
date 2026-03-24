import type { Insight, InsightSupportingData, InsightMethodology } from '@/types';

/**
 * Section Cluster Insights
 *
 * Groups sections by trend direction (improving / declining / stable) and
 * generates aggregate insights when 2+ sections share the same trend.
 *
 * This is a TypeScript-side approximation of geographic clustering: instead
 * of using spatial R-tree grouping (future Rust implementation), we group
 * sections by their performance trend similarity.
 *
 * Framed as observation, not advice:
 * - Improving: "3 sections improving" with names
 * - Declining: "2 sections to revisit" (positive framing, never punitive)
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
// Generation logic
// ---------------------------------------------------------------------------

/**
 * Generate cluster insights from section trend data.
 *
 * Returns 0-2 insights:
 * - One for the improving cluster (if 2+ sections improving)
 * - One for the declining cluster (if 2+ sections declining)
 *
 * Stable sections are not surfaced (no actionable signal).
 */
export function generateSectionClusterInsights(
  sectionTrends: SectionTrendData[],
  now: number,
  t: TFunc
): Insight[] {
  if (!sectionTrends || sectionTrends.length === 0) return [];

  const improving = sectionTrends.filter((s) => s.trend === 1);
  const declining = sectionTrends.filter((s) => s.trend === -1);

  const insights: Insight[] = [];

  // Improving cluster
  if (improving.length >= MIN_CLUSTER_SIZE) {
    insights.push(makeClusterInsight(improving, 'improving', now, t));
  }

  // Declining cluster — framed positively as "sections to revisit"
  if (declining.length >= MIN_CLUSTER_SIZE) {
    insights.push(makeClusterInsight(declining, 'declining', now, t));
  }

  return insights.slice(0, MAX_CLUSTER_INSIGHTS);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClusterInsight(
  sections: SectionTrendData[],
  direction: 'improving' | 'declining',
  now: number,
  t: TFunc
): Insight {
  // Sort by traversal count descending so most-visited sections appear first
  const sorted = [...sections].sort((a, b) => b.traversalCount - a.traversalCount);
  const names = sorted.slice(0, MAX_LISTED_NAMES).map((s) => s.sectionName);
  const nameList = names.join(', ');
  const count = sections.length;

  const isImproving = direction === 'improving';

  const supportingData: InsightSupportingData = {
    sections: sorted.slice(0, 10).map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      bestTime: s.bestTimeSecs,
      trend: s.trend,
      traversalCount: s.traversalCount,
    })),
    algorithmDescription: t('insights.sectionCluster.methodology'),
  };

  const methodology: InsightMethodology = {
    name: 'Trend-based section clustering',
    description: t('insights.sectionCluster.methodology'),
  };

  return {
    id: `section_cluster-${direction}`,
    category: 'section_cluster',
    priority: 3,
    icon: isImproving ? 'trending-up' : 'map-marker-path',
    iconColor: isImproving ? '#66BB6A' : '#FFA726',
    title: isImproving
      ? t('insights.sectionCluster.improvingTitle', { count })
      : t('insights.sectionCluster.decliningTitle', { count }),
    body: isImproving
      ? t('insights.sectionCluster.improvingBody', { names: nameList, count })
      : t('insights.sectionCluster.decliningBody', { names: nameList, count }),
    navigationTarget: '/routes',
    timestamp: now,
    isNew: false,
    supportingData,
    methodology,
  };
}
