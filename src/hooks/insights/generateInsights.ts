import type { Insight, InsightCategory, InsightPriority } from '@/types';
import { formatPaceCompact, formatSwimPace } from '@/lib';
import { detectStalePROpportunities, stalePROpportunityToInsight } from './stalePrDetection';
import { generateEfficiencyTrendInsights } from './efficiencyTrendInsights';
import { generateSectionPRInsights } from './sectionPRInsights';
import { generateHrvTrendInsight } from './hrvTrendInsight';
import {
  generatePeriodComparisonInsights,
  formatDurationCompact,
} from './periodComparisonInsights';
import { generateFitnessMilestoneInsights } from './fitnessMilestoneInsights';
import { generateSectionTrendInsights } from './sectionTrendInsights';

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

// ---------------------------------------------------------------------------
// Input types -- these match what the FFI functions return
// ---------------------------------------------------------------------------

interface PeriodStats {
  count: number;
  totalDuration: number; // seconds
  totalDistance: number; // meters
  totalTss: number;
}

interface FtpTrend {
  latestFtp: number | undefined;
  latestDate: bigint | number | undefined;
  previousFtp: number | undefined;
  previousDate: bigint | number | undefined;
}

interface PaceTrend {
  latestPace: number | undefined;
  latestDate: bigint | number | undefined;
  previousPace: number | undefined;
  previousDate: bigint | number | undefined;
}

interface SectionPR {
  sectionId: string;
  sectionName: string;
  bestTime: number;
  daysAgo: number;
}

interface ActivityPattern {
  sportType: string;
  primaryDay: number; // 0=Mon..6=Sun
  avgDurationSecs: number;
  confidence: number;
  activityCount: number;
}

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

export interface InsightInputData {
  currentPeriod: PeriodStats | null;
  previousPeriod: PeriodStats | null;
  ftpTrend: FtpTrend | null;
  paceTrend: PaceTrend | null;
  swimPaceTrend?: PaceTrend | null;
  recentPRs: SectionPR[];
  todayPattern: ActivityPattern | null;
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

// Translation function type
type TFunc = (key: string, params?: Record<string, string | number>) => string;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INSIGHTS = 8;
const MAX_STALE_PR_SECTIONS_IN_BODY = 3;

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
  addStalePRInsights(insights, data, now, t);

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

// ---------------------------------------------------------------------------
// Stale PR (uses shared stalePrDetection, kept inline for inter-insight dedup)
// ---------------------------------------------------------------------------

function addStalePRInsights(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  if ((!data.ftpTrend && !data.paceTrend) || !data.sectionTrends || data.sectionTrends.length === 0)
    return;

  const sections = data.sectionTrends.map((s) => ({
    sectionId: s.sectionId,
    sectionName: s.sectionName,
    bestTimeSecs: s.bestTimeSecs,
    traversalCount: s.traversalCount,
    sportType: s.sportType,
  }));

  const opportunities = detectStalePROpportunities({
    sections,
    ftpTrend: data.ftpTrend,
    runPaceTrend: data.paceTrend,
    swimPaceTrend: data.swimPaceTrend ?? null,
    recentPRs: data.recentPRs,
  });

  const filtered = opportunities.filter(
    (opp) => !insights.some((i) => i.id === `section_pr-${opp.sectionId}`)
  );

  if (filtered.length === 0) return;

  if (filtered.length === 1) {
    insights.push(stalePROpportunityToInsight(filtered[0], t, now));
  } else {
    const powerOpps = filtered.filter((o) => o.fitnessMetric === 'power');
    const runPaceOpps = filtered.filter((o) => o.fitnessMetric === 'pace' && o.unit === '/km');
    const swimPaceOpps = filtered.filter((o) => o.fitnessMetric === 'pace' && o.unit === '/100m');
    const subtitleParts: string[] = [];
    if (powerOpps.length > 0) {
      const p = powerOpps[0];
      subtitleParts.push(`FTP: ${Math.round(p.previousValue)}W → ${Math.round(p.currentValue)}W`);
    }
    if (runPaceOpps.length > 0) {
      const p = runPaceOpps[0];
      subtitleParts.push(
        `Run threshold: ${formatPaceCompact(p.previousValue)}${p.unit} → ${formatPaceCompact(p.currentValue)}${p.unit}`
      );
    }
    if (swimPaceOpps.length > 0) {
      const p = swimPaceOpps[0];
      subtitleParts.push(
        `Swim threshold: ${formatSwimPace(p.previousValue)}${p.unit} → ${formatSwimPace(p.currentValue)}${p.unit}`
      );
    }

    insights.push({
      id: 'stale_pr-group',
      category: 'stale_pr' as InsightCategory,
      priority: 2 as InsightPriority,
      icon: 'lightning-bolt',
      iconColor: '#FF9800',
      title: t('insights.stalePr.groupTitle', { count: filtered.length }),
      subtitle: subtitleParts.join(', '),
      body:
        filtered
          .slice(0, MAX_STALE_PR_SECTIONS_IN_BODY)
          .map((o) => o.sectionName)
          .join(', ') +
        (filtered.length > MAX_STALE_PR_SECTIONS_IN_BODY
          ? ` (+${filtered.length - MAX_STALE_PR_SECTIONS_IN_BODY} more)`
          : ''),
      navigationTarget: '/routes?tab=sections',
      timestamp: now,
      isNew: false,
      supportingData: {
        sections: filtered.map((o) => ({
          sectionId: o.sectionId,
          sectionName: o.sectionName,
          bestTime: o.bestTimeSecs,
          sportType: sections.find((s) => s.sectionId === o.sectionId)?.sportType,
        })),
        formula: subtitleParts.join('; '),
        algorithmDescription: t('insights.stalePr.methodology'),
      },
      methodology: {
        name: t('insights.methodology.fitnessPrName'),
        description: t('insights.stalePr.methodology'),
      },
    });
  }
}
