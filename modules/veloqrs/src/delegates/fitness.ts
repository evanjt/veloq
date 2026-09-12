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
  FfiInsightsParams,
  FfiPaceTrend,
  FfiMonthlyStats,
  FfiPeriodStats,
  FfiStalePrOpportunity,
  FfiStartupData,
  FfiWeekLoadShape,
  FfiWidgetSnapshotData,
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
  sampleCount: 0,
};

const EMPTY_PACE_TREND: FfiPaceTrend = {
  latestPace: undefined,
  latestDate: undefined,
  previousPace: undefined,
  previousDate: undefined,
  sampleCount: 0,
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
  params: FfiInsightsParams
): FfiInsightsData | undefined {
  if (!host.ready) return undefined;
  return host.timed('getInsightsData', () => host.engine.fitness().getInsightsData(params));
}

export function getStartupData(
  host: DelegateHost,
  params: FfiInsightsParams,
  previewActivityIds: string[]
): FfiStartupData | undefined {
  if (!host.ready) return undefined;
  return host.timed('getStartupData', () =>
    host.engine.fitness().getStartupData(params, previewActivityIds)
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

/**
 * How a week's load was spread, or `null` when the engine withheld a reading.
 * It withholds below four training days, because the ratio is a constant on a
 * sparser week, and half of a real account's weeks are that sparse.
 */
export function getWeekLoadShape(
  host: DelegateHost,
  startTs: number,
  endTs: number
): FfiWeekLoadShape | null {
  if (!host.ready) return null;
  return (
    host.timed('getWeekLoadShape', () =>
      host.engine.fitness().getWeekLoadShape(BigInt(startTs), BigInt(endTs))
    ) ??
    null
  );
}

export function savePaceSnapshot(
  host: DelegateHost,
  sportType: string,
  criticalSpeed: number,
  dPrime?: number,
  r2?: number,
  date?: number
): void {
  // Stamped at the call, not at the write: a snapshot held until the engine
  // opens still belongs to the moment the curve was fitted.
  const ts = BigInt(date ?? Math.floor(Date.now() / 1000));
  host.write('savePaceSnapshot', () => {
    try {
      host.engine.fitness().savePaceSnapshot(sportType, criticalSpeed, dPrime, r2, ts);
    } catch {
      // Pace snapshot save failed - non-critical
    }
  });
}

export function getAvailableSportTypes(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('getAvailableSportTypes', () => host.engine.fitness().getAvailableSportTypes());
}

/**
 * Aggregated totals for one window: count, duration, distance, TSS.
 *
 * `activity_metrics` covers exactly what `activity_bodies` covers, since the
 * sync writes both from the same page, so this answers any window the screens
 * hold rather than only the GPS sync range.
 */
export function getPeriodStats(
  host: DelegateHost,
  startTs: number,
  endTs: number
): FfiPeriodStats | null {
  if (!host.ready) return null;
  return host.timed('getPeriodStats', () =>
    host.engine.fitness().getPeriodStats(BigInt(startTs), BigInt(endTs))
  );
}

/**
 * A window's totals grouped by calendar month, oldest first.
 *
 * Months with no activity are absent rather than zero: a caller drawing a fixed
 * twelve bars fills the gaps itself, and rows of zeroes would be the same answer
 * with more rows.
 */
export function getMonthlyStats(
  host: DelegateHost,
  startTs: number,
  endTs: number
): FfiMonthlyStats[] {
  if (!host.ready) return [];
  return host.timed('getMonthlyStats', () =>
    host.engine.fitness().getMonthlyStats(BigInt(startTs), BigInt(endTs))
  );
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
  /** The untyped intervals.icu body for this day, when the caller has it. */
  raw?: string;
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
        raw: r.raw ?? undefined,
      }))
    )
  );
}

/**
 * Untyped wellness bodies over an inclusive date window, oldest first.
 *
 * The wellness screens read fields the typed row does not model (hrr,
 * hrvSDNN), so they parse these rather than a lossy reconstruction. Days
 * synced before the body column existed are absent rather than partial.
 */
export function getWellnessBodies(host: DelegateHost, oldest: string, newest: string): string[] {
  if (!host.ready) return [];
  return (
    host.timed('getWellnessBodies', () =>
      host.engine.fitness().getWellnessBodies(oldest, newest)
    ) ?? []
  );
}

export function getWellnessSparklines(host: DelegateHost, days: number): WellnessSparklines | null {
  if (!host.ready) return null;
  return (
    host.timed('getWellnessSparklines', () => host.engine.fitness().getWellnessSparklines(days)) ??
    null
  );
}

export function computeHrvTrend(host: DelegateHost, days: number): HrvTrendResult | null {
  if (!host.ready) return null;
  return host.timed('computeHrvTrend', () => host.engine.fitness().computeHrvTrend(days)) ?? null;
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

/** A stored curve: the body the server sent, and when it was fetched. */
export interface StoredCurve {
  raw: string;
  /** Epoch milliseconds, so callers compare it against `Date.now()`. */
  fetchedAt: number;
}

function toStoredCurve(row: { raw: string; fetchedAt: bigint } | undefined): StoredCurve | null {
  // The column is epoch seconds, which is what every other body table stores.
  return row ? { raw: row.raw, fetchedAt: Number(row.fetchedAt) * 1000 } : null;
}

/** A stored power curve, or null when it has never been fetched. */
export function getPowerCurve(
  host: DelegateHost,
  sport: string,
  days: number
): StoredCurve | null {
  if (!host.ready) return null;
  return toStoredCurve(
    host.timed('getPowerCurve', () => host.engine.fitness().getPowerCurve(sport, BigInt(days)))
  );
}

/** A stored pace curve, keyed by sport, window and the gap flag. */
export function getPaceCurve(
  host: DelegateHost,
  sport: string,
  days: number,
  gap: boolean
): StoredCurve | null {
  if (!host.ready) return null;
  return toStoredCurve(
    host.timed('getPaceCurve', () => host.engine.fitness().getPaceCurve(sport, BigInt(days), gap))
  );
}

/** An activity's stored interval body, or null if never fetched. */
export function getIntervalBody(host: DelegateHost, activityId: string): string | null {
  if (!host.ready) return null;
  return (
    (host.timed('getIntervalBody', () =>
      host.engine.fitness().getIntervalBody(activityId)
    ) as string | undefined) ?? null
  );
}

/** Calendar event bodies over an inclusive window, oldest first. */
export function getCalendarEventBodies(
  host: DelegateHost,
  oldestTs: number,
  newestTs: number
): string[] {
  if (!host.ready) return [];
  return (
    host.timed('getCalendarEventBodies', () =>
      host.engine.fitness().getCalendarEventBodies(BigInt(oldestTs), BigInt(newestTs))
    ) ?? []
  );
}

/**
 * Weekly training totals derived from `activity_metrics`, one entry per
 * supplied Monday. Week boundaries are a local-calendar question, so the
 * caller computes them and Rust only aggregates.
 */
export function getWeeklySummaries(
  host: DelegateHost,
  weekStarts: number[],
  weekLengthSecs: number
): {
  weekStart: number;
  count: number;
  movingTime: number;
  distance: number;
  trainingLoad: number;
}[] {
  if (!host.ready || weekStarts.length === 0) return [];
  const rows = host.timed('getWeeklySummaries', () =>
    host.engine
      .fitness()
      .getWeeklySummaries(weekStarts.map(BigInt), BigInt(weekLengthSecs))
  ) as {
    weekStart: bigint;
    count: number;
    movingTime: bigint;
    distance: number;
    trainingLoad: number;
  }[];
  return rows.map((r) => ({
    weekStart: Number(r.weekStart),
    count: r.count,
    movingTime: Number(r.movingTime),
    distance: r.distance,
    trainingLoad: r.trainingLoad,
  }));
}

/**
 * Everything the home-screen widget snapshot is composed from, in one
 * round-trip: wellness sparklines, the summary card, and the latest activity
 * with its record flag and GPS track.
 *
 * `maxGpsPoints` is the widget's own point budget. The track used to cross
 * whole on every background transition and every settled sync, for JavaScript
 * to keep 150 points of it. Zero asks for the whole track.
 */
export function getWidgetSnapshot(
  host: DelegateHost,
  currentStart: number,
  currentEnd: number,
  prevStart: number,
  prevEnd: number,
  sparklineDays: number,
  maxGpsPoints: number
): FfiWidgetSnapshotData | undefined {
  if (!host.ready) return undefined;
  return host.timed('getWidgetSnapshot', () =>
    host.engine
      .fitness()
      .getWidgetSnapshot(
        BigInt(currentStart),
        BigInt(currentEnd),
        BigInt(prevStart),
        BigInt(prevEnd),
        sparklineDays,
        maxGpsPoints
      )
  );
}
