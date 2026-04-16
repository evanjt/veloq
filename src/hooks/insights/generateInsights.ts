import { generateStalePRInsights } from './stalePrDetection';
import { generateEfficiencyTrendInsights } from './efficiencyTrendInsights';
import { generateSectionPRInsights } from './sectionPRInsights';
import { generateHrvTrendInsight } from './hrvTrendInsight';
import {
  generatePeriodComparisonInsights,
  formatDurationCompact,
} from './periodComparisonInsights';
import { generateFitnessMilestoneInsights } from './fitnessMilestoneInsights';
import { generateSectionTrendInsights } from './sectionTrendInsights';
import type {
  Insight,
  PeriodStats,
  FtpTrend,
  PaceTrend,
  SectionPR,
  SectionTrendData,
  TFunc,
} from './types';

// Re-export for tests and consumers
export { formatDurationCompact };

/**
 * Insight priority ranking (1 = highest):
 * 1. Section PRs set in last 7 days (Veloq's unique differentiator)
 * 2. TSB form position, HRV trend, period comparison, weekly load change, FTP/pace milestones
 * 3. Section trends, training consistency
 * 4. Activity patterns
 *
 * All insights are INFORMATIONAL only — no prescriptive advice.
 *
 * Insights are generated from cached FFI data — no new queries needed.
 */

export interface InsightInputData {
  currentPeriod: PeriodStats | null;
  previousPeriod: PeriodStats | null;
  ftpTrend: FtpTrend | null;
  paceTrend: PaceTrend | null;
  swimPaceTrend?: PaceTrend | null;
  recentPRs: SectionPR[];
  sectionTrends: SectionTrendData[];
  formTsb: number | null;
  formCtl: number | null;
  formAtl: number | null;
  peakCtl: number | null;
  currentCtl: number | null;
  wellnessWindow?: Array<{
    date: string;
    hrv?: number;
    restingHR?: number;
    sleepSecs?: number;
    ctl?: number;
    atl?: number;
  }>;
  chronicPeriod?: PeriodStats | null;
  allSectionTrends?: SectionTrendData[];
  efficiencyTrendSectionIds?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INSIGHTS = 8;

// ---------------------------------------------------------------------------
// Scoring — ranks insights by actionability and surprise value
// ---------------------------------------------------------------------------

function scoreInsight(insight: Insight): number {
  const priorityScore = (6 - insight.priority) * 50;
  const confidenceScore = (insight.confidence ?? 0.5) * 30;

  let categoryBonus = 0;
  switch (insight.category) {
    case 'section_pr':
      categoryBonus = 15;
      break;
    case 'efficiency_trend':
      categoryBonus = 12;
      break;
    case 'stale_pr':
      categoryBonus = 10;
      break;
    case 'fitness_milestone':
      categoryBonus = 10;
      break;
    case 'hrv_trend':
      categoryBonus = 8;
      break;
    case 'period_comparison':
      categoryBonus = 5;
      break;
    case 'section_trend':
      categoryBonus = 7;
      break;
    case 'strength_balance':
      categoryBonus = 6;
      break;
    case 'strength_progression':
      categoryBonus = 4;
      break;
  }

  return priorityScore + confidenceScore + categoryBonus;
}

// ---------------------------------------------------------------------------
// Debug logging — __DEV__ only
// ---------------------------------------------------------------------------

interface InsightCandidate {
  id: string;
  category: string;
  priority: number;
  score: number;
  included: boolean;
  reason?: string;
}

function logInsightGeneration(candidates: InsightCandidate[], final: Insight[]): void {
  if (!__DEV__) return;

  console.log('\n[INSIGHTS] ═══════════════════════════════════════');
  console.log(`[INSIGHTS] Generated ${candidates.length} candidates, kept ${final.length}`);

  for (const c of candidates) {
    const status = c.included ? '  KEPT' : 'DROPPED';
    const reason = c.reason ? ` (${c.reason})` : '';
    console.log(
      `[INSIGHTS] [${status}] ${c.category}/${c.id} — priority=${c.priority} score=${c.score.toFixed(0)}${reason}`
    );
  }

  console.log('[INSIGHTS] ═══════════════════════════════════════\n');
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function generateInsights(data: InsightInputData, t: TFunc): Insight[] {
  const insights: Insight[] = [];
  const now = Date.now();

  // Priority 1: Section PRs
  insights.push(...generateSectionPRInsights(data.recentPRs, now, t));

  // Priority 2: HRV Trend
  insights.push(...generateHrvTrendInsight(data.wellnessWindow, now, t));

  // Priority 2: Period Comparison
  insights.push(
    ...generatePeriodComparisonInsights(
      data.currentPeriod,
      data.previousPeriod,
      data.chronicPeriod,
      now,
      t
    )
  );

  // Priority 2: FTP/Pace Milestones
  insights.push(
    ...generateFitnessMilestoneInsights(data.ftpTrend, data.paceTrend, data.swimPaceTrend, now, t)
  );

  // Priority 2: Stale PR / Opportunity Detection
  if ((data.ftpTrend || data.paceTrend) && data.sectionTrends && data.sectionTrends.length > 0) {
    const sections = data.sectionTrends.map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      bestTimeSecs: s.bestTimeSecs,
      traversalCount: s.traversalCount,
      sportType: s.sportType,
    }));
    const existingStalePrIds = new Set(insights.map((i) => i.id));
    insights.push(
      ...generateStalePRInsights(
        {
          sections,
          ftpTrend: data.ftpTrend,
          runPaceTrend: data.paceTrend,
          swimPaceTrend: data.swimPaceTrend ?? null,
          recentPRs: data.recentPRs,
          existingInsightIds: existingStalePrIds,
        },
        t,
        now
      )
    );
  }

  // Priority 2-3: Section Trends
  const existingIds = new Set(
    insights.flatMap((i) => {
      const match = i.id.match(/section_pr-(.+)|stale_pr-(.+)/);
      return match ? [match[1] ?? match[2]] : [];
    })
  );
  insights.push(...generateSectionTrendInsights(data.sectionTrends, existingIds, now, t));

  // Priority 1: Aerobic Efficiency Trends
  const sectionIds = data.efficiencyTrendSectionIds;
  if (sectionIds && sectionIds.length > 0) {
    insights.push(...generateEfficiencyTrendInsights(sectionIds, now, t));
  }

  // Score and rank insights, then cap at MAX_INSIGHTS
  const scored = insights.map((insight) => ({
    insight,
    score: scoreInsight(insight),
  }));
  scored.sort((a, b) => b.score - a.score || a.insight.priority - b.insight.priority);

  const kept = scored.slice(0, MAX_INSIGHTS).map((s) => s.insight);

  // Debug logging
  if (__DEV__) {
    const keptIds = new Set(kept.map((i) => i.id));
    const candidates: InsightCandidate[] = scored.map((s) => ({
      id: s.insight.id,
      category: s.insight.category,
      priority: s.insight.priority,
      score: s.score,
      included: keptIds.has(s.insight.id),
      reason: keptIds.has(s.insight.id) ? undefined : 'exceeded MAX_INSIGHTS',
    }));
    logInsightGeneration(candidates, kept);
  }

  return kept;
}
