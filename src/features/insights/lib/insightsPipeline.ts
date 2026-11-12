/**
 * The insights cards, made from the engine's insights bundle.
 *
 * This module and everything it imports run in the app and in the linked
 * browser, so none of it reaches React Native, the native module or the
 * engine: what differs between the two is passed in as `InsightsEnv`.
 */
import type { SectionChangeInput } from '../generators/sectionChanged';
import type {
  generateStrengthInsights,
  normaliseStrengthProgression,
  normaliseStrengthSummary,
} from '@/features/strength';
import { decodeCoords } from 'veloqrs/src/coords';

import type {
  InsightsData,
  PeriodComparison as EnginePeriodComparison,
  PeriodStats,
  SectionChange,
} from 'veloqrs';

import type { Insight, PeriodComparison, SectionRankingScores, SeriesPoint } from '../types';
import { generateInsights, recordConsolidation } from './generateInsights';
import type { ConsolidationDrop } from './generateInsights';
import { insightPairKeys, sectionPairKey } from './sectionIdentity';
import { INSIGHTS_CONFIG } from './config';
import { LOAD_METRIC } from './engineEnums';

/** The engine's comparison, with its metric as the word the generators key on. */
function toComparison(raw: EnginePeriodComparison | undefined): PeriodComparison | null {
  if (!raw) return null;
  return {
    metric: raw.metric === LOAD_METRIC.tss ? 'tss' : 'duration',
    current: raw.current,
    previous: raw.previous,
    ratio: raw.ratio,
    comparedStart: raw.comparedStart,
  };
}

type TFunc = (key: string, params?: Record<string, string | number>) => string;

/**
 * Wellness data needed for insight generation.
 * This is the subset of intervals.icu wellness that generateInsights uses.
 * Can come from TanStack Query (React) or direct API fetch (background task).
 */
/**
 * Visible changes the ledger recorded.
 *
 * The rows ride the insights bundle with the name the athlete is shown for
 * each section, and the encoded line is decoded for the insight's history.
 */
function namedSectionChanges(
  changes: readonly SectionChange[],
  ledgerDate: (at: string) => Date
): SectionChangeInput[] {
  return changes.map((c) => {
    let points: SectionChangeInput['points'];
    try {
      points = decodeCoords(c.encodedPolyline).map((point) => ({
        lat: point.latitude,
        lng: point.longitude,
      }));
    } catch {
      points = undefined;
    }
    return {
      sectionId: c.sectionId,
      sectionName: c.sectionName,
      kind: c.kind,
      at: ledgerDate(c.at).getTime(),
      points,
    };
  });
}

/** What the caller knows that the bundle does not. */
export interface InsightsEnv {
  /** Whether the athlete has route matching on; sections-derived cards need it. */
  routeMatchingOn: boolean;
  /** Whether the experimental aerobic efficiency trend is on. */
  efficiencyTrendsOn: boolean;
  /** A ledger row's `at` as an instant. */
  ledgerDate: (at: string) => Date;
  /** One line for the development log, or nothing. */
  log?: ((line: string) => void) | undefined;
  /** The strength feature's own normalisers and card generator. */
  strength: {
    summary: typeof normaliseStrengthSummary;
    progression: typeof normaliseStrengthProgression;
    cards: typeof generateStrengthInsights;
  };
}

function isSectionStoryInsight(insight: Insight): boolean {
  return insight.category === 'stale_pr' || insight.category === 'efficiency_trend';
}

export function consolidateInsights(
  insights: Insight[],
  log?: ((line: string) => void) | undefined
): Insight[] {
  if (insights.length <= 1) {
    recordConsolidation(insights, []);
    return insights;
  }

  // Every section and sport a PR card covers, collected before anything is kept. Read
  // in one pass, the drop below fired only when the PR happened to come first,
  // which held because `section_pr` outranked `stale_pr` by priority and this
  // function used to sort by priority. It arrives in score order now.
  const prPairKeys = new Set<string>();
  for (const insight of insights) {
    if (insight.category === 'section_pr') {
      insightPairKeys(insight).forEach((key) => prPairKeys.add(key));
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
  const storyPairKeys = new Set<string>();
  let keptSectionStories = 0;

  for (const insight of insights) {
    if (insight.category === 'section_pr') {
      kept.push(insight);
      continue;
    }

    if (isSectionStoryInsight(insight)) {
      if (keptSectionStories >= INSIGHTS_CONFIG.limits.sectionStories) {
        dropped.push({
          insight,
          reason: `section story limit (max ${INSIGHTS_CONFIG.limits.sectionStories})`,
        });
        continue;
      }

      const pairKeys = insightPairKeys(insight);
      if (pairKeys.length > 0) {
        if (pairKeys.every((key) => prPairKeys.has(key))) {
          dropped.push({
            insight,
            reason: 'duplicate section (already covered by PR insight)',
          });
          continue;
        }
        if (pairKeys.every((key) => prPairKeys.has(key) || storyPairKeys.has(key))) {
          dropped.push({
            insight,
            reason: 'duplicate section (already covered by an earlier story)',
          });
          continue;
        }
      }

      kept.push(insight);
      keptSectionStories += 1;
      pairKeys.forEach((key) => storyPairKeys.add(key));
      continue;
    }

    kept.push(insight);
  }

  recordConsolidation(kept, dropped);

  if (log && dropped.length > 0) {
    log(`[INSIGHTS] Consolidation dropped ${dropped.length} insights:`);
    for (const d of dropped) {
      log(`[INSIGHTS]   ${d.insight.category}/${d.insight.id} - ${d.reason}`);
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
 */
/** `failed` tells a pipeline that threw from a library with nothing to say. */
export interface InsightsComputation {
  insights: Insight[];
  failed: boolean;
}

export function computeInsightsFromData(
  ffiData: InsightsData | null,
  t: TFunc,
  isMetric: boolean,
  env: InsightsEnv
): InsightsComputation {
  if (!ffiData) return { insights: [], failed: false };

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

    // Section readiness check - skip when route matching is disabled
    const routeMatchingOn = env.routeMatchingOn;
    const sectionCount = routeMatchingOn ? (ffiData.sectionCount ?? 0) : 0;
    const sectionsReady = sectionCount > 0;

    // Build section trends from the ranked sections the bundle carries.
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
        ranking?: SectionRankingScores;
        recentEfforts?: SeriesPoint[];
      }
    >();

    if (sectionsReady) {
      // The engine's trend batch has already applied the evidence and age gates.
      // Older fixtures use the ranked batch and the generator's fallback gate.
      for (const { sportType, sections } of ffiData.trendSections ?? ffiData.rankedSections ?? []) {
        for (const rs of sections) {
          if (!rs.sectionId) continue;
          // Keyed by section and sport: the same section ridden and run is two
          // ranked entries, and the first sport read must not hide the other.
          const pairKey = sectionPairKey(rs.sectionId, sportType);
          if (!sectionTrendMap.has(pairKey)) {
            sectionTrendMap.set(pairKey, {
              sectionId: rs.sectionId,
              sectionName: rs.sectionName || 'Section',
              trend: rs.trend,
              medianRecentSecs: rs.medianRecentSecs,
              bestTimeSecs: rs.bestTimeSecs,
              traversalCount: rs.traversalCount,
              sportType,
              daysSinceLast: rs.daysSinceLast,
              ranking: {
                relevance: rs.relevanceScore,
                recency: rs.recencyScore,
                improvement: rs.improvementScore,
                anomaly: rs.anomalyScore,
                engagement: rs.engagementScore,
                // Left off rather than set to undefined or zero when the
                // engine compared nothing.
                ...(rs.improvementChange !== undefined && rs.improvementBasis !== undefined
                  ? {
                      improvementChange: rs.improvementChange,
                      improvementBasis: rs.improvementBasis,
                    }
                  : {}),
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
      ? namedSectionChanges(ffiData.recentSectionChanges ?? [], env.ledgerDate)
      : [];

    // Aerobic efficiency trends arrive already filtered and capped by Rust.
    // They are experimental, so they reach the list only with the
    // experimental switch and the trend's own entry on. The caller reads that
    // so every caller, the widget included, takes the same gate; a headless
    // refresh that never loaded the setting reads off.
    const efficiencyTrends =
      env.efficiencyTrendsOn && sectionsReady ? (ffiData.efficiencyTrends ?? []) : [];

    // Recent PRs (skip if sections aren't loaded)
    const recentPRs = sectionsReady
      ? (ffiData.recentPrs ?? []).flatMap((pr) => {
          // One polyline the decoder rejects drops its own card, not the list.
          try {
            return [
              {
                sectionId: pr.sectionId,
                sectionName: pr.sectionName,
                bestTime: pr.bestTime,
                daysAgo: pr.daysAgo,
                sportType: pr.sportType,
                traversalCount: pr.traversalCount,
                standingCount: pr.standingCount,
                percentileFaster: pr.percentileFaster ?? undefined,
                previousBestTime: pr.previousBestTime ?? undefined,
                previousBestDate: pr.previousBestDate ?? undefined,
                deltaSeconds: pr.deltaSeconds ?? undefined,
                recentEfforts: pr.recentEfforts,
                bestActivityId: pr.bestActivityId,
                // Thinned by the engine to what a thumbnail draws, so this decodes
                // tens of points per card rather than a consensus line.
                previewPoints: decodeCoords(pr.encodedPolyline).map((p) => ({
                  lat: p.latitude,
                  lng: p.longitude,
                })),
              },
            ];
          } catch (err) {
            // empty-on-error: a polyline decode failure drops one card, and no engine read throws here.
            console.error('[insights] dropped a record whose polyline did not decode', err);
            return [];
          }
        })
      : [];

    // Strength rides the same bundle, so it enters the same pipeline.
    const strengthSeries = ffiData.hasStrengthData ? ffiData.strengthSeries : undefined;

    const coreInsights = generateInsights(
      {
        currentPeriod: toPeriod(ffiData.currentWeek),
        previousPeriod: toPeriod(ffiData.previousWeek),
        ftpTrend: ffiData.ftpTrend ?? null,
        paceTrend: ffiData.runPaceTrend ?? null,
        swimPaceTrend: ffiData.swimPaceTrend ?? null,
        isMetric,
        recentPRs,
        sectionTrends,
        sectionTrendCounts: ffiData.trendSections
          ? { faster: ffiData.trendFasterCount, slower: ffiData.trendSlowerCount }
          : undefined,
        chronicPeriod,
        chronicWeeks: (ffiData.weeklyTotals ?? []).map((week) => ({
          start: week.start,
          stats: toPeriod(week.stats),
          partial: week.partial,
        })),
        weekOverWeek: toComparison(ffiData.weekOverWeek),
        weekAgainstChronic: toComparison(ffiData.weekAgainstChronic),
        efficiencyTrends,
        sectionChanges,
        hrvTrend: ffiData.hrvTrend ?? null,
        stalePrOpportunities: ffiData.stalePrOpportunities ?? [],
        routeInsights: routeMatchingOn ? (ffiData.routeInsights ?? []) : [],
        routeInsightCounts: {
          records: ffiData.routeRecordCount ?? 0,
          faster: ffiData.routeFasterCount ?? 0,
          slower: ffiData.routeSlowerCount ?? 0,
        },
        strengthMonthly: strengthSeries ? env.strength.summary(strengthSeries.monthly) : null,
        strengthWeekly: strengthSeries?.weekly.map(env.strength.summary) ?? [],
        strengthProgressions: strengthSeries?.progressions.map(env.strength.progression) ?? [],
      },
      t,
      env.strength.cards
    );

    // A consolidation that throws leaves the list as the generators made it.
    let consolidated = coreInsights;
    try {
      consolidated = consolidateInsights(coreInsights, env.log);
    } catch (err) {
      console.error('[insights] consolidation failed, showing the unconsolidated list', err);
    }

    if (env.log) {
      env.log(
        `[INSIGHTS] Final: ${consolidated.length} insights (${coreInsights.length} before consolidation)`
      );
      for (const i of consolidated) {
        env.log(`[INSIGHTS]   ${i.category}/${i.id} - P${i.priority} "${i.title.slice(0, 60)}"`);
      }
    }

    return { insights: consolidated, failed: false };
  } catch (err) {
    console.error('[insights] pipeline failed', err);
    return { insights: [], failed: true };
  }
}
