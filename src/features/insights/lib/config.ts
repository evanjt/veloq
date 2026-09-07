import type { InsightCategory } from '../types';

/**
 * Single source of truth for insight curation. Every threshold, cap, window,
 * and score bonus used by the rules pipeline lives here. Generators and the
 * push scheduler both import from this file - one edit affects both.
 *
 * Each field is annotated with the rule it implements (G1–G4, R5–R8, D9–D12)
 * and the research citation in the plan file
 * (/home/evan/.claude/plans/hi-couoe-you-tak3-vivid-lemur.md).
 */

/**
 * The one knob that matters most. Drives both the event-recency gate (G1) and
 * the proximity gate (G2). Rationale: Peak-End / Rhodes & Kates 2015 - affective
 * recall is short, so an insight's *triggering event* must have happened in the
 * last 4 weeks; Fogg B=MAP / COM-B - a section outside the last-28-day active
 * region fails the "opportunity" leg of the action line.
 */
export const ACTIVE_WINDOW_DAYS = 28;

export type RecencyBounds = { min?: number; max?: number };

export interface InsightsConfig {
  activeWindowDays: number;

  /** G1 - per-category max event age, in days. Inherits activeWindowDays unless overridden. */
  recency: Partial<Record<InsightCategory, RecencyBounds>>;

  /** G3 - minimum lifetime repetitions for trend-type insights. */
  repetition: {
    section_trend_min: number;
    /** The declining branch alone, which has to earn more than an improvement. */
    section_trend_declining_min: number;
    efficiency_trend_min: number;
    stale_pr_min_lifetime: number;
    strength_min_sets: number;
  };

  /** Named versions of previously-inline magic numbers. */
  thresholds: {
    volumeChangePct: number;
    minFtpChangeWatts: number;
    minFtpGainPercent: number;
    minProgressChangePct: number;
    /** R6 - lower/upper bounds of the flow corridor on |delta|/stddev. */
    signalFloorDelta: number;
    signalCeilingDelta: number;
  };

  /** G2 - proximity gate. */
  proximity: {
    enabled: boolean;
    /** km of padding added to the last-28d bbox before rejecting. */
    paddingKm: number;
    /** Skip the gate if fewer than this many activities fall in the window. */
    minActivitiesForRegion: number;
  };

  /** R5/R7 + category base bonuses. Tunable without code changes. */
  scoring: {
    /** R4 - points a confidence of 1 is worth. */
    confidenceWeight: number;
    /**
     * R4 - observations at which a category's claim is as well founded as it
     * gets. Categories absent from this table have no population to count and
     * declare that instead of computing one.
     */
    confidenceSaturation: Partial<Record<InsightCategory, number>>;
    specificityBonus: { all3: number; any2: number };
    temporalSelfBonus: number;
    categoryBase: Record<InsightCategory, number>;
  };

  /** D9/D10 - panel caps. */
  surface: {
    maxTotal: number;
    /** Default max per category. Overridden by `maxPerCategoryOverride` entries. */
    maxPerCategory: number;
    /**
     * Per-category overrides. Section/route insights are the niche
     * differentiator, so they get more headroom than generic categories.
     */
    maxPerCategoryOverride: Partial<Record<InsightCategory, number>>;
  };

  /** D11 - push notification scheduler. */
  push: {
    enabled: boolean;
    maxPerWeek: number;
    minHoursBetween: number;
  };

  debug: {
    logCandidates: boolean;
    showDebugPanel: boolean;
  };
}

const __dev__ = typeof __DEV__ !== 'undefined' && __DEV__;

export const INSIGHTS_CONFIG: InsightsConfig = {
  activeWindowDays: ACTIVE_WINDOW_DAYS,

  recency: {
    // A fresh PR is the strongest signal - tighter window than the default.
    section_pr: { max: 14 },
    // Inverted: we *want* staleness here. The PR has to be old enough to
    // represent a real opportunity. There is deliberately no upper bound: a
    // fixed ceiling competes with the seasons, so a climb ridden each summer
    // is excluded every spring, which is when it is worth suggesting. Bounding
    // it wants an interval measured against the section's own visit rhythm.
    stale_pr: { min: 30, max: Number.POSITIVE_INFINITY },
    // "This week" loses meaning outside the week.
    period_comparison: { max: 7 },
    // A re-cut is news for a fortnight, then it is just the section.
    section_changed: { max: 14 },
    // Everything else defaults to activeWindowDays.
  },

  repetition: {
    section_trend_min: 3, // Lally 2010 - trend needs ≥3 repetitions
    // A decline is the one card that tells the athlete they got worse, and it
    // arrives during the bad patch that produced it. Three traversals inside
    // the 28-day window is as likely to be weather, traffic or one tired day,
    // so the declining branch waits for five: the smallest floor a single bad
    // week on a section ridden every other day cannot reach on its own.
    // The asymmetry is the decision that the panel is a mirror: a negative
    // fact is shown when the evidence supports it, and this is what supporting
    // it means for a trend. Ten is still what saturates the confidence.
    section_trend_declining_min: 5,
    efficiency_trend_min: 3,
    stale_pr_min_lifetime: 2, // had to have been meaningful at least once
    strength_min_sets: 4,
  },

  thresholds: {
    volumeChangePct: 0.15,
    minFtpChangeWatts: 5,
    minFtpGainPercent: 3,
    minProgressChangePct: 15,
    signalFloorDelta: 0.5,
    signalCeilingDelta: 2.0,
  },

  proximity: {
    enabled: true,
    paddingKm: 25,
    minActivitiesForRegion: 5,
  },

  scoring: {
    confidenceWeight: 30,
    // Each saturation is a multiple of the category's repetition floor, which
    // is the point the generator may speak at all. Reaching it means the claim
    // has as much behind it as this generator can put there; below it the
    // score is proportionally thinner, so a trend over two efforts ranks under
    // the same trend over ten.
    confidenceSaturation: {
      efficiency_trend: 10,
      // A daily FTP series and a pace history are both read in snapshots, and
      // the pace query caps at twenty, so twenty is as much as either shows.
      fitness_milestone: 20,
      section_pr: 10,
      hrv_trend: 7,
      period_comparison: 10,
      section_trend: 10,
      stale_pr: 10,
      strength_balance: 8,
      strength_progression: 6,
    },
    specificityBonus: { all3: 10, any2: 5 },
    temporalSelfBonus: 5,
    categoryBase: {
      section_pr: 15,
      efficiency_trend: 12,
      stale_pr: 10,
      fitness_milestone: 10,
      hrv_trend: 8,
      section_trend: 7,
      strength_balance: 6,
      period_comparison: 5,
      strength_progression: 4,
      section_changed: 6,
    },
  },

  surface: {
    maxTotal: 8,
    maxPerCategory: 2,
    // Section/route insights are Veloq's niche - allow a bit more headroom.
    maxPerCategoryOverride: {
      section_pr: 3,
      stale_pr: 3,
    },
  },

  push: {
    enabled: true,
    maxPerWeek: 4,
    minHoursBetween: 18,
  },

  debug: {
    logCandidates: __dev__,
    showDebugPanel: __dev__,
  },
};

/**
 * Resolve the effective max-age (days) for an insight category, falling back
 * to activeWindowDays when the category has no explicit override.
 */
export function maxAgeDaysFor(
  category: InsightCategory,
  cfg: InsightsConfig = INSIGHTS_CONFIG
): number {
  return cfg.recency[category]?.max ?? cfg.activeWindowDays;
}

/**
 * Minimum age (days) required for a category - only meaningful for `stale_pr`,
 * where *absence* of a recent event is the signal. Zero for everything else.
 */
export function minAgeDaysFor(
  category: InsightCategory,
  cfg: InsightsConfig = INSIGHTS_CONFIG
): number {
  return cfg.recency[category]?.min ?? 0;
}

/** Resolve the effective per-category surface cap. */
export function maxPerCategoryFor(
  category: InsightCategory,
  cfg: InsightsConfig = INSIGHTS_CONFIG
): number {
  return cfg.surface.maxPerCategoryOverride[category] ?? cfg.surface.maxPerCategory;
}

// R4 - how much population an insight's claim stands on. A generator either
// counts what it measured or says it counted nothing, and the ranker treats
// the two differently. An uncomputed confidence used to take a flat 0.5, which
// is why a generator that measured nothing outscored one that honestly
// measured two days of seven.

/**
 * A generator with no population to count says so with this rather than
 * leaving the field out. A section that was recut is a ledger fact, and a
 * personal record is one measured effort, not a sample of them.
 */
export const NO_POPULATION = null;

/**
 * Confidence from `observations`, against the category's saturation count.
 * A category with no saturation entry has nothing to count against, so it
 * declares an absence rather than inventing one.
 */
export function confidenceFrom(
  category: InsightCategory,
  observations: number,
  cfg: InsightsConfig = INSIGHTS_CONFIG
): number | null {
  const saturation = cfg.scoring.confidenceSaturation[category];
  if (saturation == null || saturation <= 0) return NO_POPULATION;
  if (!Number.isFinite(observations) || observations <= 0) return 0;
  return Math.min(1, observations / saturation);
}
