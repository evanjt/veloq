import { getAllSectionDisplayNames } from '@/features/routes/lib/sectionDisplayNames';
import type { SectionChangeInput } from '../generators/sectionChanged';
import { ledgerDate } from '@/features/routes/lib/sectionLedger';
import type { StrengthSummary } from '@/features/strength/types';
import { normalizeStrengthProgression } from '@/features/strength';
import { isRouteMatchingEnabled } from '@/features/routes/stores/RouteSettingsStore';
import { getEngine } from '@/shared/native/engine';

import { LoadMetric, decodeCoords } from 'veloqrs';
import type {
  InsightsData,
  PeriodComparison as EnginePeriodComparison,
  PeriodStats,
  SectionChange,
  SummaryCardData,
} from 'veloqrs';

import type { Insight, PeriodComparison, SectionRankingScores, SeriesPoint } from '../types';
import { generateInsights, recordConsolidation } from './generateInsights';
import type { ConsolidationDrop } from './generateInsights';
import { buildInsightsParams } from './insightsParams';
import { debug } from '@/shared/debug/debug';

const log = debug.create('ComputeInsightsData');

/** The engine's comparison, with its metric as the word the generators key on. */
function toComparison(raw: EnginePeriodComparison | undefined): PeriodComparison | null {
  if (!raw) return null;
  return {
    metric: raw.metric === LoadMetric.Tss ? 'tss' : 'duration',
    current: raw.current,
    previous: raw.previous,
    ratio: raw.ratio,
  };
}

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
  balance?: {
    id: string;
    leftSlug: string;
    rightSlug: string;
    leftWeightedSets: number;
    rightWeightedSets: number;
    dominantSlug?: string | null;
    ratio?: number | null;
    status: string;
  }[];
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
    balance: (raw.balance ?? []).map((pair) => ({
      ...pair,
      dominantSlug: pair.dominantSlug ?? null,
      ratio: pair.ratio ?? null,
      status: pair.status as StrengthSummary['balance'][number]['status'],
    })),
  };
}

/**
 * Wellness data needed for insight generation.
 * This is the subset of intervals.icu wellness that generateInsights uses.
 * Can come from TanStack Query (React) or direct API fetch (background task).
 */
/**
 * Visible changes the ledger recorded, named.
 *
 * The rows ride the insights bundle, which is one engine call for the whole
 * screen: reading them here cost a second call on top of the heaviest read in
 * the tree. Only the naming stays, because the display names are a memo this
 * side and not a column.
 */
function namedSectionChanges(changes: readonly SectionChange[]): SectionChangeInput[] {
  try {
    const names = getAllSectionDisplayNames();
    return changes.map((c) => ({
      sectionId: c.sectionId,
      sectionName: names[c.sectionId] ?? c.sectionId,
      kind: c.kind,
      at: ledgerDate(c.at).getTime(),
    }));
  } catch {
    // A naming lookup that cannot answer is an unnamed list, never a feed that
    // does not render.
    return [];
  }
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
  if (insights.length <= 1) {
    recordConsolidation(insights, []);
    return insights;
  }

  // Every section a PR card covers, collected before anything is kept. Read
  // in one pass, the drop below fired only when the PR happened to come first,
  // which held because `section_pr` outranked `stale_pr` by priority and this
  // function used to sort by priority. It arrives in score order now.
  const prSectionIds = new Set<string>();
  for (const insight of insights) {
    if (insight.category === 'section_pr') {
      getInsightSectionIds(insight).forEach((sectionId) => prSectionIds.add(sectionId));
    }
  }

  const kept: Insight[] = [];
  const dropped: ConsolidationDrop[] = [];
  // Grows as stories are kept, so two stories about one section still collapse
  // to the first. That one is order-dependent on purpose: the order is the
  // score order, so the stronger card is the one that stays. Kept apart from
  // the PR set so the drop reason names whichever card actually covered the
  // section: the debug panel is the one tool for asking why a card is
  // missing, and a story blamed on a PR sends the reader after a card that
  // was never generated.
  const storySectionIds = new Set<string>();
  let keptSectionStories = 0;

  for (const insight of insights) {
    if (insight.category === 'section_pr') {
      kept.push(insight);
      continue;
    }

    if (isSectionStoryInsight(insight)) {
      if (keptSectionStories >= MAX_SECTION_STORY_INSIGHTS) {
        dropped.push({
          insight,
          reason: `section story limit (max ${MAX_SECTION_STORY_INSIGHTS})`,
        });
        continue;
      }

      const sectionIds = getInsightSectionIds(insight);
      if (sectionIds.length > 0) {
        if (sectionIds.every((sectionId) => prSectionIds.has(sectionId))) {
          dropped.push({
            insight,
            reason: 'duplicate section (already covered by PR insight)',
          });
          continue;
        }
        if (
          sectionIds.every(
            (sectionId) => prSectionIds.has(sectionId) || storySectionIds.has(sectionId)
          )
        ) {
          dropped.push({
            insight,
            reason: 'duplicate section (already covered by an earlier story)',
          });
          continue;
        }
      }

      kept.push(insight);
      keptSectionStories += 1;
      sectionIds.forEach((sectionId) => storySectionIds.add(sectionId));
      continue;
    }

    kept.push(insight);
  }

  recordConsolidation(kept, dropped);

  if (__DEV__ && dropped.length > 0) {
    log.log(`[INSIGHTS] Consolidation dropped ${dropped.length} insights:`);
    for (const d of dropped) {
      log.log(`[INSIGHTS]   ${d.insight.category}/${d.insight.id} - ${d.reason}`);
    }
  }

  return kept;
}

/**
 * Compute insights from the engine's bundle.
 *
 * Pure function - no React hooks, no context, no side effects.
 * Can be called from:
 *   - useInsights() hook (React context)
 *   - backgroundInsightTask (TaskManager context, no React)
 *
 * Form rides the bundle, so neither caller reads a month of wellness rows to
 * hand back three numbers: the window it is read from is a parameter of the
 * bundle (`buildInsightsParams`).
 *
 * @param ffiData - Pre-computed FFI data from engine.getInsightsData() or getStartupData()
 * @param t - Translation function (from useTranslation() or i18n.t directly)
 * @returns Ranked array of insights
 */
export function computeInsightsFromData(
  ffiData: InsightsData | null,
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

    // The chronic window as one week of it, divided by the engine.
    const chronicPeriod = toPeriod(ffiData.chronicWeekAverage);

    // Form as the engine read it off the newest day in the window the params
    // asked for. Absent when that window holds no day at all, which is a
    // library synced a month ago rather than an athlete at zero.
    const form = ffiData.form ?? null;
    const ctl = form?.ctl ?? 0;
    const atl = form?.atl ?? 0;

    // Section readiness check - skip when route matching is disabled
    const routeMatchingOn = isRouteMatchingEnabled();
    const sectionCount = routeMatchingOn ? (ffiData.sectionCount ?? 0) : 0;
    const sectionsReady = sectionCount > 0;

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
        recentEfforts?: SeriesPoint[];
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
              // Straight across. The ranker holds every traversal to take its
              // medians from and sends the tail of them, so the card draws a
              // line without the sheet reading the engine again per open.
              recentEfforts: rs.recentEfforts,
            });
          }
        }
      }
    }

    const sectionTrends = Array.from(sectionTrendMap.values());

    // Visible changes the ledger recorded in the last fortnight, named.
    const sectionChanges = sectionsReady
      ? namedSectionChanges(ffiData.recentSectionChanges ?? [])
      : [];

    // Aerobic efficiency trends arrive already filtered and capped by Rust.
    const efficiencyTrends = sectionsReady ? (ffiData.efficiencyTrends ?? []) : [];

    // Recent PRs (skip if sections aren't loaded)
    const recentPRs = sectionsReady
      ? (ffiData.recentPrs ?? []).map((pr) => ({
          sectionId: pr.sectionId,
          sectionName: pr.sectionName,
          bestTime: pr.bestTime,
          daysAgo: pr.daysAgo,
          sportType: pr.sportType,
          traversalCount: pr.traversalCount,
          recentEfforts: pr.recentEfforts,
          // Thinned by the engine to what a thumbnail draws, so this decodes
          // tens of points per card rather than a consensus line.
          previewPoints: decodeCoords(pr.encodedPolyline).map((p) => ({
            lat: p.latitude,
            lng: p.longitude,
          })),
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
        formTsb: form ? form.tsb : null,
        formCtl: ctl > 0 ? ctl : null,
        formAtl: atl > 0 ? atl : null,
        peakCtl: null,
        currentCtl: ctl > 0 ? ctl : null,
        chronicPeriod,
        chronicWeeks: (ffiData.chronicWeeks ?? []).map(toPeriod),
        weekOverWeek: toComparison(ffiData.weekOverWeek),
        weekAgainstChronic: toComparison(ffiData.weekAgainstChronic),
        allSectionTrends: sectionTrends,
        efficiencyTrends,
        sectionChanges,
        hrvTrend: ffiData.hrvTrend ?? null,
        stalePrOpportunities: ffiData.stalePrOpportunities ?? [],
        strengthMonthly: strengthSeries ? normalizeStrengthSummary(strengthSeries.monthly) : null,
        strengthWeekly: strengthSeries?.weekly.map(normalizeStrengthSummary) ?? [],
        strengthProgressions: strengthSeries?.progressions.map(normalizeStrengthProgression) ?? [],
      },
      t
    );

    const consolidated = consolidateInsights(coreInsights);

    if (__DEV__) {
      log.log(
        `[INSIGHTS] Final: ${consolidated.length} insights (${coreInsights.length} before consolidation)`
      );
      for (const i of consolidated) {
        log.log(`[INSIGHTS]   ${i.category}/${i.id} - P${i.priority} "${i.title.slice(0, 60)}"`);
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
  const engine = getEngine();
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
