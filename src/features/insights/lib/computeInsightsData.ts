import { getAllSectionDisplayNames } from '@/features/routes/lib/sectionDisplayNames';
import type { SectionChangeInput } from '../generators/sectionChanged';
import { ledgerDate } from '@/features/routes/lib/sectionLedger';
import type { StrengthSummary } from '@/features/strength/types';
import { isRouteMatchingEnabled } from '@/features/routes/stores/RouteSettingsStore';
import { getRouteEngine } from '@/shared/native/routeEngine';

import type { InsightsData, PeriodStats, SummaryCardData } from 'veloqrs';

import type { Insight, SectionRankingScores } from '../types';
import { generateInsights } from './generateInsights';
import { buildInsightsParams } from './insightsParams';

type TFunc = (key: string, params?: Record<string, string | number>) => string;

function normalizeStrengthSummary(raw: {
  muscleVolumes?: {
    slug: string;
    primarySets: number;
    secondarySets: number;
    weightedSets: number;
    totalReps: number;
    totalWeightKg: number;
    exerciseNames: string[];
  }[];
  activityCount?: number;
  totalSets?: number;
}): StrengthSummary {
  return {
    muscleVolumes: (raw.muscleVolumes ?? []).map((volume) => ({
      slug: volume.slug,
      primarySets: volume.primarySets,
      secondarySets: volume.secondarySets,
      weightedSets: volume.weightedSets,
      totalReps: volume.totalReps,
      totalWeightKg: volume.totalWeightKg,
      exerciseNames: volume.exerciseNames,
    })),
    activityCount: raw.activityCount ?? 0,
    totalSets: raw.totalSets ?? 0,
  };
}

/**
 * Wellness data needed for insight generation.
 * This is the subset of intervals.icu wellness that generateInsights uses.
 * Can come from TanStack Query (React) or direct API fetch (background task).
 */
/**
 * Visible changes the ledger recorded in the last fortnight, named. An
 * input that cannot be read is an empty list, never a broken feed.
 */
function recentSectionChanges(): SectionChangeInput[] {
  try {
    const engine = getRouteEngine();
    if (!engine) return [];
    const names = getAllSectionDisplayNames();
    return engine.getRecentSectionChanges(14).map((c) => ({
      sectionId: c.sectionId,
      sectionName: names[c.sectionId] ?? c.sectionId,
      kind: c.kind,
      at: ledgerDate(c.at).getTime(),
    }));
  } catch {
    return [];
  }
}

export interface WellnessInput {
  id: string; // date string YYYY-MM-DD
  ctl?: number | null;
  ctlLoad?: number | null;
  atl?: number | null;
  atlLoad?: number | null;
  hrv?: number | null;
  restingHR?: number | null;
  sleepSecs?: number | null;
}

interface InsightsEnginePayload {
  insightsData: InsightsData;
  summaryCardData: SummaryCardData | null;
}

const MAX_SECTION_STORY_INSIGHTS = 2;

function isSectionStoryInsight(insight: Insight): boolean {
  return insight.category === 'stale_pr' || insight.category === 'efficiency_trend';
}

function getInsightSectionIds(insight: Insight): string[] {
  const sections = insight.supportingData?.sections ?? [];
  const sectionIds = sections
    .map((section) => section.sectionId)
    .filter((sectionId): sectionId is string => !!sectionId);

  if (sectionIds.length > 0) return sectionIds;

  if (insight.navigationTarget?.startsWith('/section/')) {
    return [insight.navigationTarget.replace('/section/', '')];
  }

  return [];
}

export function consolidateInsights(insights: Insight[]): Insight[] {
  if (insights.length <= 1) return insights;

  const sorted = [...insights].sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp);

  const kept: Insight[] = [];
  const dropped: { id: string; category: string; reason: string }[] = [];
  const seenSectionIds = new Set<string>();
  let keptSectionStories = 0;

  for (const insight of sorted) {
    if (insight.category === 'section_pr') {
      getInsightSectionIds(insight).forEach((sectionId) => seenSectionIds.add(sectionId));
      kept.push(insight);
      continue;
    }

    if (isSectionStoryInsight(insight)) {
      if (keptSectionStories >= MAX_SECTION_STORY_INSIGHTS) {
        dropped.push({
          id: insight.id,
          category: insight.category,
          reason: `section story limit (max ${MAX_SECTION_STORY_INSIGHTS})`,
        });
        continue;
      }

      const sectionIds = getInsightSectionIds(insight);
      if (sectionIds.length > 0 && sectionIds.every((sectionId) => seenSectionIds.has(sectionId))) {
        dropped.push({
          id: insight.id,
          category: insight.category,
          reason: 'duplicate section (already covered by PR insight)',
        });
        continue;
      }

      kept.push(insight);
      keptSectionStories += 1;
      sectionIds.forEach((sectionId) => seenSectionIds.add(sectionId));
      continue;
    }

    kept.push(insight);
  }

  if (__DEV__ && dropped.length > 0) {
    console.log(`[INSIGHTS] Consolidation dropped ${dropped.length} insights:`);
    for (const d of dropped) {
      console.log(`[INSIGHTS]   ${d.category}/${d.id} - ${d.reason}`);
    }
  }

  return kept;
}

/**
 * Compute insights from engine data + wellness data.
 *
 * Pure function - no React hooks, no context, no side effects.
 * Can be called from:
 *   - useInsights() hook (React context)
 *   - backgroundInsightTask (TaskManager context, no React)
 *
 * @param ffiData - Pre-computed FFI data from engine.getInsightsData() or getStartupData()
 * @param wellnessData - Wellness entries (from TanStack Query or direct API fetch)
 * @param t - Translation function (from useTranslation() or i18n.t directly)
 * @returns Ranked array of insights
 */
export function computeInsightsFromData(
  ffiData: InsightsData | null,
  wellnessData: WellnessInput[] | null,
  t: TFunc,
  summaryCardData?: SummaryCardData | null
): Insight[] {
  if (!ffiData) return [];

  try {
    // Convert FFI bigint fields to number
    const toPeriod = (p: PeriodStats) => ({
      count: p.count,
      totalDuration: Number(p.totalDuration),
      totalDistance: p.totalDistance,
      totalTss: p.totalTss,
    });

    // Average chronic period per week (raw total / 4 weeks)
    const chronicPeriod = {
      count: Math.round(ffiData.chronicPeriod.count / 4),
      totalDuration: Number(ffiData.chronicPeriod.totalDuration) / 4,
      totalDistance: ffiData.chronicPeriod.totalDistance / 4,
      totalTss: ffiData.chronicPeriod.totalTss / 4,
    };

    // Compute CTL/ATL/TSB from wellness
    const sortedWellness = (wellnessData ?? []).sort((a, b) => a.id.localeCompare(b.id));
    const latestWellness =
      sortedWellness.length > 0 ? sortedWellness[sortedWellness.length - 1] : null;
    const ctl = latestWellness?.ctl ?? latestWellness?.ctlLoad ?? 0;
    const atl = latestWellness?.atl ?? latestWellness?.atlLoad ?? 0;
    const tsb = ctl - atl;

    // Section readiness check - skip when route matching is disabled
    const routeMatchingOn = isRouteMatchingEnabled();
    const sectionCount = routeMatchingOn ? (ffiData.sectionCount ?? 0) : 0;
    const sectionsReady = sectionCount > 0;

    const allPatterns = ffiData.allPatterns ?? [];

    // Build section trends from the ML-ranked sections the bundle carries.
    const sectionTrendMap = new Map<
      string,
      {
        sectionId: string;
        sectionName: string;
        trend: number;
        medianRecentSecs: number;
        bestTimeSecs: number;
        traversalCount: number;
        sportType?: string;
        daysSinceLast?: number;
        latestIsPr?: boolean;
        ranking?: SectionRankingScores;
      }
    >();

    if (sectionsReady) {
      // Note: we keep the full unfiltered list here so the stale_pr
      // detector (which needs OLD sections) still works on the TS fallback
      // path. The section_trend generator does its own recency filter
      // internally using INSIGHTS_CONFIG.activeWindowDays.
      for (const { sportType, sections } of ffiData.rankedSections ?? []) {
        for (const rs of sections) {
          if (!rs.sectionId) continue;
          if (!sectionTrendMap.has(rs.sectionId)) {
            sectionTrendMap.set(rs.sectionId, {
              sectionId: rs.sectionId,
              sectionName: rs.sectionName || 'Section',
              trend: rs.trend,
              medianRecentSecs: rs.medianRecentSecs,
              bestTimeSecs: rs.bestTimeSecs,
              traversalCount: rs.traversalCount,
              sportType,
              daysSinceLast: rs.daysSinceLast,
              latestIsPr: rs.latestIsPr,
              ranking: {
                relevance: rs.relevanceScore,
                recency: rs.recencyScore,
                improvement: rs.improvementScore,
                anomaly: rs.anomalyScore,
                engagement: rs.engagementScore,
              },
            });
          }
        }
      }
    }

    // Fallback: pattern-based commonSections
    if (sectionTrendMap.size === 0 && sectionsReady) {
      for (const pattern of allPatterns) {
        if (!pattern.commonSections) continue;
        for (const section of pattern.commonSections) {
          if (section.trend == null || !section.sectionId) continue;
          const existing = sectionTrendMap.get(section.sectionId);
          if (!existing || section.traversalCount > existing.traversalCount) {
            sectionTrendMap.set(section.sectionId, {
              sectionId: section.sectionId,
              sectionName: section.sectionName || 'Section',
              trend: section.trend,
              medianRecentSecs: section.medianRecentSecs,
              bestTimeSecs: section.bestTimeSecs,
              traversalCount: section.traversalCount,
              sportType: pattern.sportType,
            });
          }
        }
      }
    }

    const sectionTrends = Array.from(sectionTrendMap.values());

    // Visible changes the ledger recorded in the last fortnight, named.
    const sectionChanges = sectionsReady ? recentSectionChanges() : [];

    // Aerobic efficiency trends arrive already filtered and capped by Rust.
    const efficiencyTrends = sectionsReady ? (ffiData.efficiencyTrends ?? []) : [];

    // Recent PRs (skip if sections aren't loaded)
    const recentPRs = sectionsReady
      ? (ffiData.recentPrs ?? []).map((pr) => ({
          sectionId: pr.sectionId,
          sectionName: pr.sectionName,
          bestTime: pr.bestTime,
          daysAgo: pr.daysAgo,
        }))
      : [];

    // Strength rides the same bundle, so it enters the same pipeline.
    const strengthSeries = ffiData.hasStrengthData ? ffiData.strengthSeries : undefined;

    const coreInsights = generateInsights(
      {
        currentPeriod: toPeriod(ffiData.currentWeek),
        previousPeriod: toPeriod(ffiData.previousWeek),
        ftpTrend: ffiData.ftpTrend ?? null,
        paceTrend: ffiData.runPaceTrend ?? null,
        swimPaceTrend: summaryCardData?.swimPaceTrend ?? null,
        recentPRs,
        sectionTrends,
        formTsb: latestWellness ? tsb : null,
        formCtl: ctl > 0 ? ctl : null,
        formAtl: atl > 0 ? atl : null,
        peakCtl: null,
        currentCtl: ctl > 0 ? ctl : null,
        chronicPeriod,
        allSectionTrends: sectionTrends,
        efficiencyTrends,
        sectionChanges,
        strengthMonthly: strengthSeries ? normalizeStrengthSummary(strengthSeries.monthly) : null,
        strengthWeekly: strengthSeries?.weekly.map(normalizeStrengthSummary) ?? [],
      },
      t
    );

    const consolidated = consolidateInsights(coreInsights);

    if (__DEV__) {
      console.log(
        `[INSIGHTS] Final: ${consolidated.length} insights (${coreInsights.length} before consolidation)`
      );
      for (const i of consolidated) {
        console.log(
          `[INSIGHTS]   ${i.category}/${i.id} - P${i.priority} "${i.title.slice(0, 60)}"`
        );
      }
    }

    return consolidated;
  } catch (err) {
    if (typeof process !== 'undefined' && process.env?.VELOQ_INSIGHTS_DEBUG) {
      console.error('[computeInsightsFromData] swallowed error:', err);
    }
    return [];
  }
}

/**
 * Fetch FFI insights data from the engine.
 * Pure function - calls synchronous FFI, no React.
 */
export function fetchInsightsDataFromEngine(): InsightsEnginePayload | null {
  const engine = getRouteEngine();
  if (!engine) return null;

  const params = buildInsightsParams();
  const insightsData = engine.getInsightsData(params) ?? null;
  if (!insightsData) return null;

  return {
    insightsData,
    summaryCardData: engine.getSummaryCardData(
      Number(params.currentStart),
      Number(params.currentEnd),
      Number(params.prevStart),
      Number(params.prevEnd)
    ),
  };
}
