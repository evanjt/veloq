/**
 * Fitness delegates.
 *
 * Wraps training load, period stats, FTP/pace trends, zone distributions,
 * activity heatmaps, and pattern detection. Covers aggregate queries used
 * across the Summary card, Insights tab, and Fitness screen.
 */

import type {
  FfiEftpChange,
  FfiFtpTrend,
  FfiInsightsData,
  FfiInsightsParams,
  FfiPaceTrend,
  FfiMonthlyStats,
  FfiPeriodStats,
  FfiStalePrOpportunity,
  FfiStartupData,
  FfiSummaryCardData,
  FfiWellnessSummary,
  FfiWidgetSnapshotData,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';
import type { HeatmapDay } from './shared-types';
import { present } from './optional';

// Pre-initialization defaults (typed to match UniFFI-generated types)
const EMPTY_PERIOD_STATS: FfiPeriodStats = {
  count: 0,
  totalDuration: 0,
  totalDistance: 0,
  totalTss: 0,
};

const EMPTY_FTP_TREND: FfiFtpTrend = { sampleCount: 0, history: [] };

const EMPTY_PACE_TREND: FfiPaceTrend = { sampleCount: 0, history: [] };

export function getActivityMetricIds(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('getActivityMetricIds', () => host.engine.fitness().getActivityMetricIds());
}

/** No library yet: every number zero or absent, and no arrow to draw. */
const EMPTY_WELLNESS_SUMMARY: FfiWellnessSummary = { fitness: 0, form: 0 };

export function getSummaryCardData(
  host: DelegateHost,
  currentStart: number,
  currentEnd: number,
  prevStart: number,
  prevEnd: number
): FfiSummaryCardData {
  if (!host.ready) {
    return {
      wellness: EMPTY_WELLNESS_SUMMARY,
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

export function savePaceSnapshot(
  host: DelegateHost,
  sportType: string,
  criticalSpeed: number,
  windowDays: number,
  dPrime?: number,
  r2?: number,
  date?: number
): void {
  // Stamped at the call, not at the write: a snapshot held until the engine
  // opens still belongs to the moment the curve was fitted.
  const ts = BigInt(date ?? Math.floor(Date.now() / 1000));
  host.write('savePaceSnapshot', () => {
    try {
      host
        .engine
        .fitness()
        .savePaceSnapshot(sportType, criticalSpeed, dPrime, r2, ts, BigInt(windowDays));
    } catch {
      // Pace snapshot save failed - non-critical
    }
  });
}

/** The activities that moved the accepted eFTP, oldest first. */
export function getEftpChanges(host: DelegateHost): FfiEftpChange[] {
  if (!host.ready) return [];
  return host.timed('getEftpChanges', () => host.engine.fitness().getEftpChanges());
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

/** One sport's contribution to a day's load, from the API's `sportInfo`. */
export interface SportLoad {
  sportGroup?: string;
  load?: number;
}

/** One stored wellness day: every field the screens render, and nothing else. */
export interface WellnessDay {
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
  sportLoad: SportLoad[];
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
      rows.map((r) =>
        present({
          date: r.date,
          ctl: r.ctl ?? undefined,
          atl: r.atl ?? undefined,
          rampRate: r.rampRate ?? undefined,
          hrv: r.hrv ?? undefined,
          restingHr: r.restingHr ?? undefined,
          weight: r.weight ?? undefined,
          sleepSecs: r.sleepSecs,
          sleepScore: r.sleepScore ?? undefined,
          soreness: r.soreness ?? undefined,
          fatigue: r.fatigue ?? undefined,
          stress: r.stress ?? undefined,
          mood: r.mood ?? undefined,
          motivation: r.motivation ?? undefined,
          raw: r.raw ?? undefined,
        })
      )
    )
  );
}

/**
 * Stored wellness days over an inclusive date window, oldest first.
 *
 * Typed, so nothing parses a body to draw a chart. A day synced before the
 * body column existed carries its columns and no per-sport breakdown.
 */
export function getWellnessDays(host: DelegateHost, oldest: string, newest: string): WellnessDay[] {
  if (!host.ready) return [];
  const days =
    host.timed('getWellnessDays', () => host.engine.fitness().getWellnessDays(oldest, newest)) ?? [];
  // Sleep is an i64 the whole way down and reaches JS as a bigint; every
  // screen reading it does arithmetic against plain numbers.
  return days.map((d) => present({ ...d, sleepSecs: d.sleepSecs }));
}

export function getWellnessLatestDate(host: DelegateHost): string | null {
  if (!host.ready) return null;
  return (
    host.timed('getWellnessLatestDate', () => host.engine.fitness().getWellnessLatestDate()) ?? null
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

/** An activity a curve point came from, as the body names it. */
export interface CurveActivityRow {
  id: string;
  name: string;
  distance: number;
  movingTime: number;
  trainingLoad: number;
  weight: number;
  startDateLocal: string;
  race: boolean;
}

/** A model the server finished fitting. */
export interface PowerModelRow {
  kind: string;
  criticalPower: number;
  wPrime: number;
  ftp: number;
  pMax?: number;
}

/** Fields every curve carries, whatever it measures. */
interface CurveRow {
  sport: string;
  activityIds?: string[];
  activities: Record<string, CurveActivityRow>;
  startDate?: string;
  endDate?: string;
  days?: number;
  /** Epoch milliseconds, so callers compare it against `Date.now()`. */
  fetchedAt: number;
}

/** A stored power curve, parsed by the engine. */
export interface PowerCurveRow extends CurveRow {
  secs: number[];
  watts: number[];
  wattsPerKg?: number[];
  wkgActivityIds?: string[];
  weight?: number;
  models: PowerModelRow[];
}

/** A stored pace curve, parsed by the engine. */
export interface PaceCurveRow extends CurveRow {
  distances: number[];
  times: number[];
  pace: number[];
  criticalSpeed?: number;
  dPrime?: number;
  r2?: number;
}

/** The engine hands the activities over as a `Map`; the app reads an object. */
function activitiesOf(
  activities: Map<string, CurveActivityRow>
): Record<string, CurveActivityRow> {
  return Object.fromEntries(activities);
}

/** The column is epoch seconds, which is what every other body table stores. */
const fetchedMs = (seconds: number): number => seconds * 1000;

/** A stored power curve, or null when it has never been fetched. */
export function getPowerCurve(
  host: DelegateHost,
  sport: string,
  days: number
): PowerCurveRow | null {
  if (!host.ready) return null;
  const row = host.timed('getPowerCurve', () =>
    host.engine.fitness().getPowerCurve(sport, BigInt(days))
  );
  if (!row) return null;
  return {
    ...row,
    activities: activitiesOf(row.activities),
    fetchedAt: fetchedMs(row.fetchedAt),
  };
}

/** A stored pace curve, keyed by sport, window and the gap flag. */
export function getPaceCurve(
  host: DelegateHost,
  sport: string,
  days: number,
  gap: boolean
): PaceCurveRow | null {
  if (!host.ready) return null;
  const row = host.timed('getPaceCurve', () =>
    host.engine.fitness().getPaceCurve(sport, BigInt(days), gap)
  );
  if (!row) return null;
  return {
    ...row,
    activities: activitiesOf(row.activities),
    fetchedAt: fetchedMs(row.fetchedAt),
  };
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
  );
  return rows.map((r) => ({
    weekStart: r.weekStart,
    count: r.count,
    movingTime: r.movingTime,
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
