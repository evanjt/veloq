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
  | 'proximity_outside_region'
  | 'repetition_below_min'
  | 'valence_punitive'
  | 'category_cap'
  | 'surface_cap';

export interface GateOutcome {
  passed: boolean;
  reason?: GateReason;
}

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
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
  };
}

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Hard gates
// ---------------------------------------------------------------------------

/**
 * G1 - event recency. Opt-in: only checked when `insight.meta.sourceTimestamp`
 * is set. Generators that already enforce recency internally (e.g. stale_pr's
 * detector) can omit sourceTimestamp to skip this gate. Rejects both too-old
 * (most categories) and too-recent (stale_pr, where staleness is the signal).
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
 * G2 - proximity. Only enforced for location-bound insights (meta.location
 * present). Rejects if centroid lies outside activeRegion + paddingKm.
 * Returns passed=true when gate is disabled or region is unknown.
 */
export function passesProximity(
  insight: Insight,
  activeRegion: Bbox | null,
  cfg: InsightsConfig = INSIGHTS_CONFIG
): GateOutcome {
  if (!cfg.proximity.enabled) return { passed: true };
  if (!activeRegion) return { passed: true }; // not enough data to enforce
  const loc = insight.meta?.location;
  if (!loc) return { passed: true }; // non-location insight

  const padDeg = kmToDegreesLat(cfg.proximity.paddingKm);
  const padLngDeg = kmToDegreesLng(
    cfg.proximity.paddingKm,
    (activeRegion.minLat + activeRegion.maxLat) / 2
  );

  const inLat = loc.lat >= activeRegion.minLat - padDeg && loc.lat <= activeRegion.maxLat + padDeg;
  const inLng =
    loc.lng >= activeRegion.minLng - padLngDeg && loc.lng <= activeRegion.maxLng + padLngDeg;

  if (inLat && inLng) return { passed: true };
  return { passed: false, reason: 'proximity_outside_region' };
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

/**
 * G4 - valence. Scans title/body for punitive patterns. Copy review is the
 * primary defence; this is a safety net.
 */
const PUNITIVE_PATTERNS = [
  /\byou (haven't|have not|didn't|did not) /i,
  /\byou (failed|missed) /i,
  /\bbehind schedule\b/i,
  /\bnot enough\b/i,
];

export function passesValence(insight: Insight): GateOutcome {
  const haystack = `${insight.title}\n${insight.body ?? ''}`;
  for (const pattern of PUNITIVE_PATTERNS) {
    if (pattern.test(haystack)) return { passed: false, reason: 'valence_punitive' };
  }
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
 * [floorDelta, ceilingDelta]; penalises below-floor noise; small credit above
 * ceiling ("surprising but possibly outlier").
 */
export function signalScore(insight: Insight, cfg: InsightsConfig = INSIGHTS_CONFIG): number {
  const delta = insight.meta?.signalDelta;
  if (delta == null || !Number.isFinite(delta)) return 0;
  const abs = Math.abs(delta);
  const { signalFloorDelta: floor, signalCeilingDelta: ceiling } = cfg.thresholds;
  if (abs >= floor && abs <= ceiling) return 10;
  if (abs > ceiling) return 3;
  return -5; // below floor - actively suppress noise-level signals
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
  const base = (6 - insight.priority) * 50;
  const confidence = confidenceScore(insight, cfg);
  const category = cfg.scoring.categoryBase[insight.category] ?? 0;
  const specificity = specificityScore(insight, cfg);
  const temporalSelf = temporalSelfScore(insight, cfg);
  const signal = signalScore(insight, cfg);

  const total = base + confidence + category + specificity + temporalSelf + signal;

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
 * D9 + D10 - sort by score, enforce per-category cap, then total cap.
 * Returns the kept list and dropped records (with reasons) for the debug panel.
 */
export function applyMixAndCap(
  scored: ScoredInsight[],
  cfg: InsightsConfig = INSIGHTS_CONFIG
): { kept: Insight[]; dropped: DropRecord[] } {
  const sorted = [...scored].sort(
    (a, b) => b.score - a.score || a.insight.priority - b.insight.priority
  );

  const perCategory = new Map<InsightCategory, number>();
  const kept: Insight[] = [];
  const dropped: DropRecord[] = [];

  for (const s of sorted) {
    if (kept.length >= cfg.surface.maxTotal) {
      dropped.push({ insight: s.insight, score: s.score, reason: 'surface_cap' });
      continue;
    }
    const used = perCategory.get(s.insight.category) ?? 0;
    if (used >= maxPerCategoryFor(s.insight.category, cfg)) {
      dropped.push({ insight: s.insight, score: s.score, reason: 'category_cap' });
      continue;
    }
    perCategory.set(s.insight.category, used + 1);
    kept.push(s.insight);
  }

  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function repetitionMinFor(category: InsightCategory, cfg: InsightsConfig): number | null {
  switch (category) {
    case 'section_trend':
      return cfg.repetition.section_trend_min;
    case 'efficiency_trend':
      return cfg.repetition.efficiency_trend_min;
    case 'stale_pr':
      return cfg.repetition.stale_pr_min_lifetime;
    default:
      return null;
  }
}

function kmToDegreesLat(km: number): number {
  return km / 111.32;
}

function kmToDegreesLng(km: number, atLat: number): number {
  const cosLat = Math.cos((atLat * Math.PI) / 180);
  if (cosLat === 0) return km / 111.32;
  return km / (111.32 * cosLat);
}
