import type { Insight, InsightCategory } from '../types';
import {
  INSIGHTS_CONFIG,
  maxAgeDaysFor,
  maxPerCategoryFor,
  minAgeDaysFor,
  type InsightsConfig,
} from './config';

export type GateReason =
  | 'recency_too_old'
  | 'recency_too_recent'
  | 'repetition_below_min'
  | 'category_cap'
  | 'surface_cap';

export interface GateOutcome {
  passed: boolean;
  reason?: GateReason;
}

export interface ScoredInsight {
  insight: Insight;
  score: number;
  breakdown: {
    base: number;
    confidence: number;
    category: number;
    specificity: number;
    temporalSelf: number;
    signal: number;
    ranking: number;
  };
}

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Hard gates
// ---------------------------------------------------------------------------

/**
 * G1 - event recency. Checked only when `insight.meta.sourceTimestamp` is
 * set, and every generator reporting an event sets it. Rejects both too-old
 * (most categories) and too-recent (stale_pr, which relies on the timestamp
 * for its inverted bound, since staleness is the signal).
 */
export function passesRecency(
  insight: Insight,
  now: number,
  cfg: InsightsConfig = INSIGHTS_CONFIG
): GateOutcome {
  const ts = insight.meta?.sourceTimestamp;
  if (ts == null || !Number.isFinite(ts)) return { passed: true };

  const ageDays = (now - ts) / DAY_MS;
  const maxDays = maxAgeDaysFor(insight.category, cfg);
  const minDays = minAgeDaysFor(insight.category, cfg);

  if (ageDays > maxDays) return { passed: false, reason: 'recency_too_old' };
  if (ageDays < minDays) return { passed: false, reason: 'recency_too_recent' };
  return { passed: true };
}

/**
 * G3 - repetition floor. Trend-type insights require enough lifetime efforts
 * for the trend to be real signal (Lally 2010). Other categories pass through.
 */
export function passesRepetition(
  insight: Insight,
  cfg: InsightsConfig = INSIGHTS_CONFIG
): GateOutcome {
  const count = insight.meta?.repetitionCount;
  if (count == null) return { passed: true }; // category doesn't carry repetition → skip

  const min = repetitionMinFor(insight.category, cfg);
  if (min == null) return { passed: true };
  if (count < min) return { passed: false, reason: 'repetition_below_min' };
  return { passed: true };
}

// ---------------------------------------------------------------------------
// Ranking signals
// ---------------------------------------------------------------------------

/**
 * R5 - proximal specificity (Bandura & Schunk 1981). +10 if all three of
 * {concrete number, concrete place, a moment other than now}; +5 for two.
 *
 * Read off the strings the athlete sees rather than asserted by the generator.
 * Eleven of fifteen emit sites used to assert a constant triple, and an
 * assertion is a claim about copy that the copy can stop honouring: a locale
 * that drops the number, or a title rewritten to lose the section name, left
 * the claim standing and kept the points.
 *
 * The date stays structural, because "recent" is a property of the insight and
 * not of its wording, and no regex reads a relative date across seventeen
 * locales. It means the insight is about a moment other than the one it was
 * computed in.
 */
export function specificityScore(insight: Insight, cfg: InsightsConfig = INSIGHTS_CONFIG): number {
  const rendered = `${insight.title}\n${insight.subtitle ?? ''}\n${insight.body ?? ''}`;
  const place = insight.meta?.placeName;
  const source = insight.meta?.sourceTimestamp;

  const hasNumber = /\d/.test(rendered);
  const hasPlace = Boolean(place) && rendered.includes(place as string);
  const hasDate = source != null && source !== insight.timestamp;

  const count = (hasNumber ? 1 : 0) + (hasPlace ? 1 : 0) + (hasDate ? 1 : 0);
  if (count === 3) return cfg.scoring.specificityBonus.all3;
  if (count === 2) return cfg.scoring.specificityBonus.any2;
  return 0;
}

/**
 * R6 - signal-to-noise (Csikszentmihalyi flow corridor). Peaks in
 * [floorDelta, ceilingDelta]; small credit above ceiling ("surprising but
 * possibly outlier"); nothing below the floor.
 *
 * Below the floor used to score -5, which put an insight that measured an
 * honest small change below one that measured nothing at all. `confidence` lost
 * the same inversion: computing a reading can help or be neutral, never cost.
 */
export function signalScore(insight: Insight, cfg: InsightsConfig = INSIGHTS_CONFIG): number {
  const delta = insight.meta?.signalDelta;
  if (delta == null || !Number.isFinite(delta)) return 0;
  const abs = Math.abs(delta);
  const { signalFloorDelta: floor, signalCeilingDelta: ceiling } = cfg.thresholds;
  if (abs >= floor && abs <= ceiling) return 10;
  if (abs > ceiling) return 3;
  return 0; // below floor - no signal to credit, and none to punish either
}

/**
 * R4 - how much population the claim stands on.
 *
 * A declared absence (`null`) and a computed confidence are not the same, and
 * neither is a default. The old `?? 0.5` gave thirteen of fifteen emit sites a
 * flat fifteen points for a confidence nobody computed, which ranked a
 * generator that measured nothing above one that measured its own thinness.
 * An absence claims no evidence weight and leaves the rank to priority and
 * category, where the number it would have carried is not one anybody has.
 */
export function confidenceScore(insight: Insight, cfg: InsightsConfig = INSIGHTS_CONFIG): number {
  const value = insight.confidence;
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value)) * cfg.scoring.confidenceWeight;
}

/**
 * R9 - what the engine says the section behind this insight is worth.
 *
 * The engine owns the blend: `persistence/sections/ranking.rs` weighs the four
 * component scores into `relevance`, and the sections tab's Relevance sort and
 * this term both read that one number, so a weight change there moves both
 * together. No component is read here and no weight table is kept here.
 *
 * An insight with no section has no such score. It takes zero and its rank
 * comes from the other terms, the same rule `confidence` follows: a declared
 * absence is not a middle.
 */
export function rankingScore(insight: Insight, cfg: InsightsConfig = INSIGHTS_CONFIG): number {
  const r = insight.meta?.ranking;
  if (!r) return 0;
  const blend = r.relevance;
  if (!Number.isFinite(blend)) return 0;
  return Math.min(1, Math.max(0, blend)) * cfg.scoring.rankingWeight;
}

/**
 * R7 - temporal-self framing bonus (Kappen 2018).
 */
export function temporalSelfScore(insight: Insight, cfg: InsightsConfig = INSIGHTS_CONFIG): number {
  if (insight.meta?.comparisonKind === 'self') return cfg.scoring.temporalSelfBonus;
  return 0;
}

/**
 * Composite score for a single insight. Returns a breakdown so the debug
 * panel can show why each insight landed where it did.
 */
export function scoreInsight(
  insight: Insight,
  cfg: InsightsConfig = INSIGHTS_CONFIG
): ScoredInsight {
  const base = (6 - insight.priority) * cfg.scoring.priorityStep;
  const confidence = confidenceScore(insight, cfg);
  const category = cfg.scoring.categoryBase[insight.category] ?? 0;
  const specificity = specificityScore(insight, cfg);
  const temporalSelf = temporalSelfScore(insight, cfg);
  const signal = signalScore(insight, cfg);
  const ranking = rankingScore(insight, cfg);

  const total = base + confidence + category + specificity + temporalSelf + signal + ranking;

  return {
    insight,
    score: total,
    breakdown: {
      base,
      confidence,
      category,
      specificity,
      temporalSelf,
      signal,
      ranking,
    },
  };
}

// ---------------------------------------------------------------------------
// Diversity & surface caps
// ---------------------------------------------------------------------------

export interface DropRecord {
  insight: Insight;
  score: number;
  reason: GateReason;
}

/**
 * Reserve category slots for improvements, sort by score across categories,
 * then enforce the total cap.
 * Returns the kept list and dropped records (with reasons) for the debug panel.
 */
export function applyMixAndCap(
  scored: ScoredInsight[],
  cfg: InsightsConfig = INSIGHTS_CONFIG
): { kept: Insight[]; dropped: DropRecord[] } {
  const byScore = (a: ScoredInsight, b: ScoredInsight) =>
    b.score - a.score || a.insight.priority - b.insight.priority;
  const sorted = [...scored].sort(byScore);
  const byCategory = new Map<InsightCategory, ScoredInsight[]>();
  for (const candidate of sorted) {
    const category = candidate.insight.category;
    const group = byCategory.get(category) ?? [];
    group.push(candidate);
    byCategory.set(category, group);
  }
  const categoryEligible = new Set<ScoredInsight>();
  for (const [category, group] of byCategory) {
    const limit = maxPerCategoryFor(category, cfg);
    const selected = group.slice(0, limit);
    const waitingImprovements = group
      .slice(limit)
      .filter((candidate) => candidate.insight.supportingData?.trend?.verdict === 'improved');
    for (const improvement of waitingImprovements) {
      const declineIndex = selected.findLastIndex(
        (candidate) => candidate.insight.supportingData?.trend?.verdict === 'declined'
      );
      if (declineIndex === -1) break;
      selected[declineIndex] = improvement;
    }
    for (const candidate of selected) {
      categoryEligible.add(candidate);
    }
  }

  const kept: Insight[] = [];
  const dropped: DropRecord[] = [];

  for (const s of sorted) {
    if (kept.length >= cfg.surface.maxTotal) {
      dropped.push({ insight: s.insight, score: s.score, reason: 'surface_cap' });
      continue;
    }
    if (!categoryEligible.has(s)) {
      dropped.push({ insight: s.insight, score: s.score, reason: 'category_cap' });
      continue;
    }
    kept.push(s.insight);
  }

  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function repetitionMinFor(category: InsightCategory, cfg: InsightsConfig): number | null {
  switch (category) {
    // The engine returns a section trend only from six traversals, so no floor
    // here could bind.
    case 'efficiency_trend':
      return cfg.repetition.efficiency_trend_min;
    case 'stale_pr':
      return cfg.repetition.stale_pr_min_lifetime;
    default:
      return null;
  }
}
