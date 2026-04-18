/**
 * Fitness delegates.
 *
 * Wraps training load, period stats, FTP/pace trends, zone distributions,
 * activity heatmaps, and pattern detection. Covers aggregate queries used
 * across the Summary card, Insights tab, and Fitness screen.
 */

import type {
  FfiFtpTrend,
  FfiInsightsData,
  FfiPaceTrend,
  FfiPeriodStats,
  FfiStalePrOpportunity,
  FfiStartupData,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';
import type { HeatmapDay } from './shared-types';

// Pre-initialization defaults (typed to match UniFFI-generated types)
const EMPTY_PERIOD_STATS: FfiPeriodStats = {
  count: 0,
  totalDuration: BigInt(0),
  totalDistance: 0,
  totalTss: 0,
};

const EMPTY_FTP_TREND: FfiFtpTrend = {
  latestFtp: undefined,
  latestDate: undefined,
  previousFtp: undefined,
  previousDate: undefined,
};

const EMPTY_PACE_TREND: FfiPaceTrend = {
  latestPace: undefined,
  latestDate: undefined,
  previousPace: undefined,
  previousDate: undefined,
};

export function getActivityMetricIds(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('getActivityMetricIds', () => host.engine.fitness().getActivityMetricIds());
}

export function getSummaryCardData(
  host: DelegateHost,
  currentStart: number,
  currentEnd: number,
  prevStart: number,
  prevEnd: number
): {
  currentWeek: FfiPeriodStats;
  prevWeek: FfiPeriodStats;
  ftpTrend: FfiFtpTrend;
  runPaceTrend: FfiPaceTrend;
  swimPaceTrend: FfiPaceTrend;
} {
  if (!host.ready) {
    return {
      currentWeek: EMPTY_PERIOD_STATS,
      prevWeek: EMPTY_PERIOD_STATS,
      ftpTrend: EMPTY_FTP_TREND,
      runPaceTrend: EMPTY_PACE_TREND,
      swimPaceTrend: EMPTY_PACE_TREND,
    };
  }
  return host.timed('getSummaryCardData', () =>
    host.engine
      .fitness()
      .getSummaryCardData(
        BigInt(currentStart),
        BigInt(currentEnd),
        BigInt(prevStart),
        BigInt(prevEnd)
      )
  );
}

export function getInsightsData(
  host: DelegateHost,
  currentStart: number,
  currentEnd: number,
  prevStart: number,
  prevEnd: number,
  chronicStart: number,
  todayStart: number
): FfiInsightsData | undefined {
  if (!host.ready) return undefined;
  return host.timed('getInsightsData', () =>
    host.engine
      .fitness()
      .getInsightsData(
        BigInt(currentStart),
        BigInt(currentEnd),
        BigInt(prevStart),
        BigInt(prevEnd),
        BigInt(chronicStart),
        BigInt(todayStart)
      )
  );
}

export function getStartupData(
  host: DelegateHost,
  currentStart: number,
  currentEnd: number,
  prevStart: number,
  prevEnd: number,
  chronicStart: number,
  todayStart: number,
  previewActivityIds: string[]
): FfiStartupData | undefined {
  if (!host.ready) return undefined;
  return host.timed('getStartupData', () =>
    host.engine
      .fitness()
      .getStartupData(
        BigInt(currentStart),
        BigInt(currentEnd),
        BigInt(prevStart),
        BigInt(prevEnd),
        BigInt(chronicStart),
        BigInt(todayStart),
        previewActivityIds
      )
  );
}

export function getPeriodStats(host: DelegateHost, startTs: number, endTs: number): FfiPeriodStats {
  if (!host.ready) return EMPTY_PERIOD_STATS;
  return host.timed('getPeriodStats', () =>
    host.engine.fitness().getPeriodStats(BigInt(startTs), BigInt(endTs))
  );
}

export function getZoneDistribution(
  host: DelegateHost,
  sportType: string,
  zoneType: string
): number[] {
  if (!host.ready) return [];
  return host.timed('getZoneDistribution', () =>
    host.engine.fitness().getZoneDistribution(sportType, zoneType)
  );
}

export function getFtpTrend(host: DelegateHost): FfiFtpTrend {
  if (!host.ready) return EMPTY_FTP_TREND;
  return host.timed('getFtpTrend', () => host.engine.fitness().getFtpTrend());
}

export function savePaceSnapshot(
  host: DelegateHost,
  sportType: string,
  criticalSpeed: number,
  dPrime?: number,
  r2?: number,
  date?: number
): void {
  if (!host.ready) return;
  const ts = date ?? Math.floor(Date.now() / 1000);
  try {
    host.timed('savePaceSnapshot', () =>
      host.engine.fitness().savePaceSnapshot(sportType, criticalSpeed, dPrime, r2, BigInt(ts))
    );
  } catch {
    // Pace snapshot save failed — non-critical
  }
}

export function getPaceTrend(host: DelegateHost, sportType: string): FfiPaceTrend {
  if (!host.ready) return EMPTY_PACE_TREND;
  return host.timed('getPaceTrend', () => host.engine.fitness().getPaceTrend(sportType));
}

export function getAvailableSportTypes(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('getAvailableSportTypes', () => host.engine.fitness().getAvailableSportTypes());
}

export function getActivityHeatmap(
  host: DelegateHost,
  startDate: string,
  endDate: string
): HeatmapDay[] {
  if (!host.ready) return [];
  return host.timed('getActivityHeatmap', () =>
    host.engine.fitness().getActivityHeatmap(startDate, endDate)
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Get activity patterns detected via k-means clustering on activity features.
 * Returns patterns meeting confidence >= 0.6 threshold.
 * K-means on [day_of_week, duration, TSS, distance] per sport type.
 */
export function getActivityPatterns(host: DelegateHost): any[] {
  if (!host.ready) return [];
  return host.timed('getActivityPatterns', () => host.engine.fitness().getActivityPatterns());
}

/**
 * Get the highest-confidence pattern matching today's day_of_week + season.
 * Convenience method for Feed tab teaser (avoids loading all patterns in JS).
 */
export function getPatternForToday(host: DelegateHost): any | undefined {
  if (!host.ready) return undefined;
  return host.timed(
    'getPatternForToday',
    () => host.engine.fitness().getPatternForToday() ?? undefined
  );
}

/**
 * Combined patterns bundle: today's pattern + full pattern set in one call.
 * Consumed by `useActivityPatterns` so the hook is a thin pass-through.
 */
export function getActivityPatternsWithToday(host: DelegateHost): {
  today: any | undefined;
  all: any[];
} {
  if (!host.ready) return { today: undefined, all: [] };
  return host.timed('getActivityPatternsWithToday', () =>
    host.engine.fitness().getActivityPatternsWithToday()
  );
}

export interface WellnessRowInput {
  date: string;
  ctl?: number;
  atl?: number;
  rampRate?: number;
  hrv?: number;
  restingHr?: number;
  weight?: number;
  sleepSecs?: number;
  sleepScore?: number;
  soreness?: number;
  fatigue?: number;
  stress?: number;
  mood?: number;
  motivation?: number;
}

export interface WellnessSparklines {
  fitness: number[];
  fatigue: number[];
  form: number[];
  hrv: number[];
  rhr: number[];
}

export interface HrvTrendResult {
  label: string;
  avg: number;
  latest: number;
  dataPoints: number;
  sparkline: number[];
}

/**
 * Upsert wellness rows (from the intervals.icu /wellness API) into SQLite.
 * Idempotent on `date`. Call once per wellness fetch so sparkline + HRV
 * atomics stay fresh.
 */
export function upsertWellness(host: DelegateHost, rows: WellnessRowInput[]): void {
  if (!host.ready || rows.length === 0) return;
  host.timed('upsertWellness', () =>
    host.engine.fitness().upsertWellness(
      rows.map((r) => ({
        date: r.date,
        ctl: r.ctl ?? undefined,
        atl: r.atl ?? undefined,
        rampRate: r.rampRate ?? undefined,
        hrv: r.hrv ?? undefined,
        restingHr: r.restingHr ?? undefined,
        weight: r.weight ?? undefined,
        sleepSecs: r.sleepSecs !== undefined ? BigInt(r.sleepSecs) : undefined,
        sleepScore: r.sleepScore ?? undefined,
        soreness: r.soreness ?? undefined,
        fatigue: r.fatigue ?? undefined,
        stress: r.stress ?? undefined,
        mood: r.mood ?? undefined,
        motivation: r.motivation ?? undefined,
      }))
    )
  );
}

export function getWellnessSparklines(
  host: DelegateHost,
  days: number
): WellnessSparklines | null {
  if (!host.ready) return null;
  return (
    host.timed('getWellnessSparklines', () =>
      host.engine.fitness().getWellnessSparklines(days)
    ) ?? null
  );
}

export function computeHrvTrend(host: DelegateHost, days: number): HrvTrendResult | null {
  if (!host.ready) return null;
  return (
    host.timed('computeHrvTrend', () => host.engine.fitness().computeHrvTrend(days)) ?? null
  );
}

export function findStalePrOpportunities(
  host: DelegateHost,
  staleThresholdDays: number,
  minGainPercent: number,
  maxOpportunities: number,
  excludeSectionIds: string[]
): FfiStalePrOpportunity[] {
  if (!host.ready) return [];
  return host.timed('findStalePrOpportunities', () =>
    host.engine
      .fitness()
      .findStalePrOpportunities(
        staleThresholdDays,
        minGainPercent,
        maxOpportunities,
        excludeSectionIds
      )
  );
}
