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
import { INSIGHTS_CONFIG } from './config';
import {
  applyMixAndCap,
  passesProximity,
  passesRecency,
  passesRepetition,
  passesValence,
  scoreInsight,
  type Bbox,
  type DropRecord,
  type GateReason,
  type ScoredInsight,
} from './rules';

// Re-export for tests and consumers
export { formatDurationCompact };

/**
 * Insight pipeline: generate → hard gates (G1–G4) → score (R5–R8) → diversity
 * cap (D9–D10). Every rule is a pure function in `rules.ts`; every threshold
 * is in `config.ts`. See the plan at
 * /home/evan/.claude/plans/hi-couoe-you-tak3-vivid-lemur.md for research
 * citations.
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
  /**
   * Bbox of activities in the last `activeWindowDays` — drives the proximity
   * gate (G2). Null disables the gate (insufficient data, gate off, etc.).
   */
  activeRegion?: Bbox | null;
}

// ---------------------------------------------------------------------------
// Pipeline outcome — exposed for the debug panel
// ---------------------------------------------------------------------------

export interface PipelineOutcome {
  kept: Insight[];
  rejected: Array<{ insight: Insight; reason: GateReason }>;
  scored: ScoredInsight[];
  capDropped: DropRecord[];
}

/**
 * Last pipeline outcome — captured so the dev debug panel can render the full
 * candidate list (kept, rejected, cap-dropped) without re-running generation.
 * Intentionally a module singleton: generation is already memoised upstream.
 */
let _lastOutcome: PipelineOutcome | null = null;

export function getLastInsightOutcome(): PipelineOutcome | null {
  return _lastOutcome;
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
    console.log(`[INSIGHTS] [GATED ] ${r.insight.category}/${r.insight.id} — ${r.reason}`);
  }
  for (const s of outcome.scored) {
    const capped = outcome.capDropped.find((d) => d.insight.id === s.insight.id);
    const status = capped ? 'CAPPED' : '  KEPT';
    const reason = capped ? ` (${capped.reason})` : '';
    // eslint-disable-next-line no-console
    console.log(
      `[INSIGHTS] [${status}] ${s.insight.category}/${s.insight.id} — score=${s.score.toFixed(0)} (base=${s.breakdown.base.toFixed(0)} cat=${s.breakdown.category} spec=${s.breakdown.specificity} self=${s.breakdown.temporalSelf} sig=${s.breakdown.signal})${reason}`
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
      // eslint-disable-next-line no-console
      console.warn(`[insights/${label}] generator failed; isolating:`, err);
    }
    return fallback;
  }
}

export function generateInsights(data: InsightInputData, t: TFunc): Insight[] {
  const candidates: Insight[] = [];
  const now = Date.now();

  // 1. Generate candidates — each generator is isolated so a thrown error
  //    from one yields zero insights for that category but does not kill
  //    the rest.
  candidates.push(...safeRun('sectionPR', () => generateSectionPRInsights(data.recentPRs, now, t)));
  candidates.push(
    ...safeRun('hrvTrend', () => generateHrvTrendInsight(data.wellnessWindow, now, t))
  );
  candidates.push(
    ...safeRun('periodComparison', () =>
      generatePeriodComparisonInsights(
        data.currentPeriod,
        data.previousPeriod,
        data.chronicPeriod,
        now,
        t
      )
    )
  );
  candidates.push(
    ...safeRun('fitnessMilestone', () =>
      generateFitnessMilestoneInsights(data.ftpTrend, data.paceTrend, data.swimPaceTrend, now, t)
    )
  );

  if ((data.ftpTrend || data.paceTrend) && data.sectionTrends && data.sectionTrends.length > 0) {
    const sections = data.sectionTrends.map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      bestTimeSecs: s.bestTimeSecs,
      traversalCount: s.traversalCount,
      sportType: s.sportType,
    }));
    const existingStalePrIds = new Set(candidates.map((i) => i.id));
    candidates.push(
      ...safeRun('stalePR', () =>
        generateStalePRInsights(
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
      )
    );
  }

  const existingIds = new Set(
    candidates.flatMap((i) => {
      const match = i.id.match(/section_pr-(.+)|stale_pr-(.+)/);
      return match ? [match[1] ?? match[2]] : [];
    })
  );
  candidates.push(
    ...safeRun('sectionTrend', () =>
      generateSectionTrendInsights(data.sectionTrends, existingIds, now, t)
    )
  );

  const sectionIds = data.efficiencyTrendSectionIds;
  if (sectionIds && sectionIds.length > 0) {
    candidates.push(
      ...safeRun('efficiencyTrend', () => generateEfficiencyTrendInsights(sectionIds, now, t))
    );
  }

  // 2. Hard gates (G1–G4) — reject before scoring
  const activeRegion = data.activeRegion ?? null;
  const rejected: Array<{ insight: Insight; reason: GateReason }> = [];
  const passed: Insight[] = [];

  for (const insight of candidates) {
    const gates = [
      passesRecency(insight, now),
      passesProximity(insight, activeRegion),
      passesRepetition(insight),
      passesValence(insight),
    ];
    const failed = gates.find((g) => !g.passed);
    if (failed && failed.reason) {
      rejected.push({ insight, reason: failed.reason });
    } else {
      passed.push(insight);
    }
  }

  // 3. Score (R5–R8 inside scoreInsight)
  const scored = passed.map((i) => scoreInsight(i));

  // 4. Diversity + surface cap (D9, D10)
  const { kept, dropped: capDropped } = applyMixAndCap(scored);

  const outcome: PipelineOutcome = { kept, rejected, scored, capDropped };
  _lastOutcome = outcome;
  logInsightGeneration(outcome);

  return kept;
}
