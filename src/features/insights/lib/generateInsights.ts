import type { EfficiencyTrend, FfiRouteInsight, HrvTrend, StalePrOpportunity } from 'veloqrs';
import type { StrengthProgressionRecord, StrengthSummary } from '@/features/strength';

import { generateStalePRInsights } from '../generators/stalePr';
import { generateEfficiencyTrendInsights } from '../generators/efficiencyTrend';
import { generateSectionPRInsights } from '../generators/sectionPR';
import { generateStrengthInsights } from '@/features/strength';
import { generateHrvTrendInsight } from '../generators/hrvTrend';
import { generatePeriodComparisonInsights } from '../generators/periodComparison';
import { generateFitnessMilestoneInsights } from '../generators/fitnessMilestone';
import { generateRouteInsights } from '../generators/routeInsights';
import type { RouteInsightCounts } from '../generators/routeInsights';
import { generateSectionTrendInsights } from '../generators/sectionTrend';
import type { SectionTrendCounts } from '../generators/sectionTrend';
import { insightPairKeys } from './sectionIdentity';
import {
  generateSectionChangedInsights,
  type SectionChangeInput,
} from '../generators/sectionChanged';
import type {
  Insight,
  PeriodComparison,
  PeriodStats,
  FtpTrend,
  PaceTrend,
  SectionPR,
  SectionRankingScores,
  SectionTrendData,
  TFunc,
} from '../types';
import { INSIGHTS_CONFIG } from './config';
import {
  applyMixAndCap,
  passesRecency,
  passesRepetition,
  scoreInsight,
  type DropRecord,
  type GateReason,
  type ScoredInsight,
} from './rules';

// Re-export for tests and consumers

/**
 * Insight pipeline: generate → hard gates (G1, G3) → score (R5–R8) → diversity
 * cap (D9–D10). Every rule is a pure function in `rules.ts`; every threshold
 * is in `config.ts`.
 */

export interface InsightInputData {
  currentPeriod: PeriodStats | null;
  previousPeriod: PeriodStats | null;
  ftpTrend: FtpTrend | null;
  paceTrend: PaceTrend | null;
  swimPaceTrend?: PaceTrend | null;
  /** The athlete's unit preference; pace cards read per mile and per 100 yd when false. */
  isMetric?: boolean;
  recentPRs: SectionPR[];
  sectionTrends: SectionTrendData[];
  sectionTrendCounts?: SectionTrendCounts | undefined;
  sectionChanges?: SectionChangeInput[];
  /** Every route bucket with a recent record or a trend, as the engine read them. */
  routeInsights?: readonly FfiRouteInsight[] | undefined;
  /** The engine's counts over those rows. */
  routeInsightCounts?: RouteInsightCounts | undefined;
  /** The HRV verdict, as the engine read it over the bundle's window. */
  hrvTrend?: HrvTrend | null;
  /** Stale-PR opportunities, already excluding the sections `recentPRs` covers. */
  stalePrOpportunities?: StalePrOpportunity[];
  chronicPeriod?: PeriodStats | null;
  /**
   * The chronic window one week at a time, oldest first, as the engine cut it.
   * The comparison card's claim is about the last four weeks, and a total plus
   * an average cannot draw it.
   */
  chronicWeeks?: PeriodStats[];
  /** This week against last, as the engine took it. */
  weekOverWeek?: PeriodComparison | null;
  /** Last week against the chronic weekly average, as the engine took it. */
  weekAgainstChronic?: PeriodComparison | null;
  /** Efficiency trends from the engine, already filtered and capped. */
  efficiencyTrends?: EfficiencyTrend[];
  /** Four-week strength rollup. Null when the athlete logs no strength work. */
  strengthMonthly?: StrengthSummary | null;
  /** Per-week strength rollups backing the progression candidates. */
  strengthWeekly?: StrengthSummary[];
  /** The engine's per-muscle ranking over those weeks. */
  strengthProgressions?: StrengthProgressionRecord[];
}

// ---------------------------------------------------------------------------
// Pipeline outcome - exposed for the debug panel
// ---------------------------------------------------------------------------

export interface PipelineOutcome {
  kept: Insight[];
  rejected: { insight: Insight; reason: GateReason }[];
  scored: ScoredInsight[];
  capDropped: DropRecord[];
  /**
   * What the screen actually renders, in the order it renders it.
   * `kept` is the pipeline's output, and consolidation runs after it: it drops
   * on the section story cap and the duplicate-section rule, and reorders what
   * is left. Null until consolidation has run for this generation.
   */
  consolidated: Insight[] | null;
  consolidationDropped: ConsolidationDrop[];
}

export interface ConsolidationDrop {
  insight: Insight;
  reason: string;
}

/**
 * Last pipeline outcome - captured so the dev debug panel can render the full
 * candidate list (kept, rejected, cap-dropped) without re-running generation.
 * Intentionally a module singleton: generation is already memoised upstream.
 */
let _lastOutcome: PipelineOutcome | null = null;

export function getLastInsightOutcome(): PipelineOutcome | null {
  return _lastOutcome;
}

/**
 * Record what consolidation did to the pipeline's output. Called by
 * `consolidateInsights`, which runs downstream of generation, so the debug
 * panel sees the list the screen shows rather than the one the pipeline
 * handed on.
 */
export function recordConsolidation(kept: Insight[], dropped: ConsolidationDrop[]): void {
  if (!_lastOutcome) return;
  _lastOutcome = { ..._lastOutcome, consolidated: kept, consolidationDropped: dropped };
}

function logInsightGeneration(outcome: PipelineOutcome): void {
  if (!INSIGHTS_CONFIG.debug.logCandidates) return;

  const total = outcome.scored.length + outcome.rejected.length;
  // eslint-disable-next-line no-console
  console.log('\n[INSIGHTS] ═══════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.log(
    `[INSIGHTS] ${total} candidates → ${outcome.kept.length} kept, ${outcome.rejected.length} gated, ${outcome.capDropped.length} capped`
  );

  for (const r of outcome.rejected) {
    // eslint-disable-next-line no-console
    console.log(`[INSIGHTS] [GATED ] ${r.insight.category}/${r.insight.id} - ${r.reason}`);
  }
  for (const s of outcome.scored) {
    const capped = outcome.capDropped.find((d) => d.insight.id === s.insight.id);
    const status = capped ? 'CAPPED' : '  KEPT';
    const reason = capped ? ` (${capped.reason})` : '';
    // eslint-disable-next-line no-console
    console.log(
      `[INSIGHTS] [${status}] ${s.insight.category}/${s.insight.id} - score=${s.score.toFixed(0)} (base=${s.breakdown.base.toFixed(0)} conf=${s.breakdown.confidence.toFixed(0)} rank=${s.breakdown.ranking.toFixed(0)} cat=${s.breakdown.category} spec=${s.breakdown.specificity} self=${s.breakdown.temporalSelf} sig=${s.breakdown.signal})${reason}`
    );
  }
  // eslint-disable-next-line no-console
  console.log('[INSIGHTS] ═══════════════════════════════════════\n');
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

function safeRun<T>(label: string, fn: () => T[], fallback: T[] = []): T[] {
  try {
    return fn();
  } catch (err) {
    if (
      typeof process !== 'undefined' &&
      process.env &&
      (process.env.VELOQ_INSIGHTS_DEBUG || process.env.NODE_ENV === 'test')
    ) {
      console.warn(`[insights/${label}] generator failed; isolating:`, err);
    }
    return fallback;
  }
}

export function generateInsights(data: InsightInputData, t: TFunc): Insight[] {
  const candidates: Insight[] = [];
  const now = Date.now();

  // 1. Generate candidates - each generator is isolated so a thrown error
  //    from one yields zero insights for that category but does not kill
  //    the rest.
  candidates.push(...safeRun('sectionPR', () => generateSectionPRInsights(data.recentPRs, now, t)));
  candidates.push(...safeRun('hrvTrend', () => generateHrvTrendInsight(data.hrvTrend, now, t)));
  candidates.push(
    ...safeRun('periodComparison', () =>
      generatePeriodComparisonInsights(
        data.currentPeriod,
        data.previousPeriod,
        data.chronicPeriod,
        data.chronicWeeks,
        data.weekOverWeek,
        data.weekAgainstChronic,
        now,
        t
      )
    )
  );
  candidates.push(
    ...safeRun('fitnessMilestone', () =>
      generateFitnessMilestoneInsights(
        data.ftpTrend,
        data.paceTrend,
        data.swimPaceTrend,
        now,
        t,
        data.isMetric
      )
    )
  );

  // Unguarded, where it used to run only with a TypeScript trend and a
  // non-empty section list to hand. The engine decides from its own trends and
  // its own ranking and answers an empty list when nothing qualifies, so a
  // second gate here could only hide a card it had already decided to show.
  candidates.push(
    ...safeRun('stalePR', () =>
      generateStalePRInsights(data.stalePrOpportunities, t, now, data.isMetric)
    )
  );

  const coveredPairs = new Set(
    candidates
      .filter((i) => i.category === 'section_pr' || i.category === 'stale_pr')
      .flatMap(insightPairKeys)
  );
  candidates.push(
    ...safeRun('sectionTrend', () =>
      generateSectionTrendInsights(
        data.sectionTrends,
        coveredPairs,
        now,
        t,
        data.sectionTrendCounts
      )
    )
  );

  candidates.push(
    ...safeRun('routeInsights', () =>
      generateRouteInsights(data.routeInsights, data.routeInsightCounts, now, t)
    )
  );

  candidates.push(
    ...safeRun('sectionChanged', () =>
      generateSectionChangedInsights(data.sectionChanges ?? [], now, t)
    )
  );

  const efficiencyTrends = data.efficiencyTrends;
  if (efficiencyTrends && efficiencyTrends.length > 0) {
    candidates.push(
      ...safeRun('efficiencyTrend', () => generateEfficiencyTrendInsights(efficiencyTrends, now, t))
    );
  }

  if (data.strengthMonthly && (data.strengthWeekly?.length ?? 0) > 0) {
    candidates.push(
      ...safeRun('strength', () =>
        generateStrengthInsights(
          data.strengthMonthly ?? null,
          data.strengthWeekly ?? [],
          data.strengthProgressions ?? [],
          now,
          t
        )
      )
    );
  }

  // 2. Hard gates (G1, G3) - reject before scoring
  const rejected: { insight: Insight; reason: GateReason }[] = [];
  const passed: Insight[] = [];

  for (const insight of candidates) {
    const gates = [passesRecency(insight, now), passesRepetition(insight)];
    const failed = gates.find((g) => !g.passed);
    if (failed && failed.reason) {
      rejected.push({ insight, reason: failed.reason });
    } else {
      passed.push(insight);
    }
  }

  // R9 wants the engine's read on the section behind each insight, and the
  // ranked list the bundle already carries is where it is. Joined here rather
  // than threaded through five generators: only `sectionTrend` is built from
  // the ranked rows, and the other four know a section id and nothing else.
  const rankingBySection = new Map(
    (data.sectionTrends ?? [])
      .filter((s) => s.ranking)
      .map((s) => [s.sectionId, s.ranking as SectionRankingScores])
  );
  for (const insight of passed) {
    const id = insight.meta?.sectionId;
    if (!id || insight.meta?.ranking) continue;
    const ranking = rankingBySection.get(id);
    if (ranking && insight.meta) insight.meta.ranking = ranking;
  }

  // 3. Score (R5–R9 inside scoreInsight)
  const scored = passed.map((i) => scoreInsight(i));

  // 4. Diversity + surface cap (D9, D10)
  const { kept, dropped: capDropped } = applyMixAndCap(scored);

  const outcome: PipelineOutcome = {
    kept,
    rejected,
    scored,
    capDropped,
    consolidated: null,
    consolidationDropped: [],
  };
  _lastOutcome = outcome;
  logInsightGeneration(outcome);

  return kept;
}
