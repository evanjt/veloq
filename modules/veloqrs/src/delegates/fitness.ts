/**
 * Fitness delegates.
 *
 * Wraps training load, period stats, FTP/pace trends, zone distributions,
 * activity heatmaps, and pattern detection. Covers aggregate queries used
 * across the Summary card, Insights tab, and Fitness screen.
 */

import type {
  FfiActivityBody,
  FfiBestEffortsData,
  FfiDayLoad,
  FfiExerciseSet,
  FfiFitnessScreenData,
  FfiFtpTrend,
  FfiInsightsData,
  FfiInsightsParams,
  FfiPaceTrend,
  FfiPeriodStats,
  FfiStartupData,
  FfiSummaryCardData,
  FfiSummaryComparison,
  FfiTrainingScreenData,
  FfiTrainingScreenWindows,
  FfiWellnessRow,
  FfiWellnessSummary,
  FfiZoneDistribution,
} from '../generated/veloqrs';
import { RangeCoverage } from '../generated/veloqrs';
import type { DelegateHost } from './host';
import { present } from './optional';

// Pre-initialisation defaults (typed to match UniFFI-generated types)
const EMPTY_PERIOD_STATS: FfiPeriodStats = {
  count: 0,
  totalDuration: 0,
  totalDistance: 0,
  totalTss: 0,
};

const EMPTY_FTP_TREND: FfiFtpTrend = { lookbackDays: 0, sampleCount: 0, history: [], changes: [] };

const EMPTY_PACE_TREND: FfiPaceTrend = { sampleCount: 0, history: [] };

/** No library yet: every number zero or absent, and no arrow to draw. */
const EMPTY_WELLNESS_SUMMARY: FfiWellnessSummary = { fitness: 0, form: 0 };

export function getSummaryCardData(host: DelegateHost, nowWallSeconds: number): FfiSummaryCardData {
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
    host.engine.fitness().getSummaryCardData(nowWallSeconds)
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
  zoneType: string,
  startTs: number,
  endTs: number
): FfiZoneDistribution {
  if (!host.ready) return { seconds: [], shares: [], names: [] };
  return host.timed('getZoneDistribution', () =>
    host.engine.fitness().getZoneDistribution(sportType, zoneType, startTs, endTs)
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
  const ts = date ?? Math.floor(Date.now() / 1000);
  host.write('savePaceSnapshot', () => {
    try {
      host.engine.fitness().savePaceSnapshot(sportType, criticalSpeed, dPrime, r2, ts, windowDays);
    } catch {
      // Pace snapshot save failed - non-critical
    }
  });
}

/**
 * Everything the fitness tab paints with that stays fixed while it is
 * mounted: the eFTP trend over the chart's three months with the activities
 * that moved it, the last stored running and swimming critical speeds, and
 * the sport the latest activities are mostly in. Stale when `activities` fires.
 */
export function getFitnessScreenData(host: DelegateHost): FfiFitnessScreenData {
  if (!host.ready) {
    return {
      ftpTrend: EMPTY_FTP_TREND,
      ftpTrendCoverage: RangeCoverage.NotFetched,
      runPaceTrend: EMPTY_PACE_TREND,
      swimPaceTrend: EMPTY_PACE_TREND,
      sportMix: { rides: 0, runs: 0, swims: 0 },
    };
  }
  return host.timed('getFitnessScreenData', () => host.engine.fitness().getFitnessScreenData());
}

export function getAvailableSportTypes(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('getAvailableSportTypes', () => host.engine.fitness().getAvailableSportTypes());
}

/**
 * Recorded activity load per local day over a window, oldest first.
 *
 * A day with activities and no recorded load is `Unavailable` and one with only
 * some is `Partial`. Days with no activities are absent.
 */
export function getDailyActivityLoads(
  host: DelegateHost,
  startTs: number,
  endTs: number
): FfiDayLoad[] {
  if (!host.ready) return [];
  return host.timed('getDailyActivityLoads', () =>
    host.engine.fitness().getDailyActivityLoads(startTs, endTs)
  );
}

/**
 * Everything the training tab paints with that stays fixed while it is
 * mounted: the heatmap days, the monthly rows, the year and month to date
 * against the same spans of last year, and the weekly card's every range
 * against the same elapsed span before it. Stale when `activities` fires.
 */
export function getTrainingScreenData(
  host: DelegateHost,
  windows: FfiTrainingScreenWindows
): FfiTrainingScreenData {
  if (!host.ready) {
    const now = { startTs: windows.nowWallSeconds, endTs: windows.nowWallSeconds };
    const empty: FfiSummaryComparison = {
      current: now,
      previous: now,
      currentStats: EMPTY_PERIOD_STATS,
      previousStats: EMPTY_PERIOD_STATS,
    };
    return {
      heatmap: [],
      months: [],
      yearCurrent: EMPTY_PERIOD_STATS,
      yearPrevious: EMPTY_PERIOD_STATS,
      monthCurrent: EMPTY_PERIOD_STATS,
      monthPrevious: EMPTY_PERIOD_STATS,
      comparisons: {
        week: empty,
        month: empty,
        threeMonths: empty,
        sixMonths: empty,
        year: empty,
      },
    };
  }
  return host.timed('getTrainingScreenData', () =>
    host.engine.fitness().getTrainingScreenData(windows)
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

/** The stored days of a window and whether the window was pulled at all. */
export interface WellnessDays {
  /** Oldest first. */
  days: WellnessDay[];
  coverage: RangeCoverage;
}

export interface WellnessSparklines {
  fitness: number[];
  fatigue: number[];
  form: number[];
  hrv: number[];
  rhr: number[];
  /** Beside `hrv` and `rhr`: whether each day had a reading of its own. */
  hrvRead: boolean[];
  rhrRead: boolean[];
  /** Last plotted value minus the first; absent under two values. */
  fitnessDelta?: number | undefined;
  fatigueDelta?: number | undefined;
  formDelta?: number | undefined;
  hrvDelta?: number | undefined;
  rhrDelta?: number | undefined;
  /** Indices into `fitness` of the days fitness rose by more than one point. */
  fitnessRiseDays?: number[];
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
  if (rows.length === 0) return;
  host.write('upsertWellness', () =>
    host.engine.fitness().upsertWellness(rows.map(wellnessRowToFfi))
  );
}

function wellnessRowToFfi(r: WellnessRowInput): FfiWellnessRow {
  return present({
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
  });
}

/**
 * Stored wellness days over an inclusive date window, oldest first, with
 * whether the window was pulled at all.
 *
 * Typed, so nothing parses a body to draw a chart. A day synced before the
 * body column existed carries its columns and no per-sport breakdown. An
 * engine that is not open yet answers `NotFetched`: nothing is known about the
 * window, and `Empty` would be a claim.
 */
export function getWellnessDays(host: DelegateHost, oldest: string, newest: string): WellnessDays {
  if (!host.ready) return { days: [], coverage: RangeCoverage.NotFetched };
  const window = host.timed('getWellnessDays', () =>
    host.engine.fitness().getWellnessDays(oldest, newest)
  );
  if (!window) return { days: [], coverage: RangeCoverage.NotFetched };
  return { days: window.days.map((d) => present(d)), coverage: window.coverage };
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
function activitiesOf(activities: Map<string, CurveActivityRow>): Record<string, CurveActivityRow> {
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
  const row = host.timed('getPowerCurve', () => host.engine.fitness().getPowerCurve(sport, days));
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
    host.engine.fitness().getPaceCurve(sport, days, gap)
  );
  if (!row) return null;
  return {
    ...row,
    activities: activitiesOf(row.activities),
    fetchedAt: fetchedMs(row.fetchedAt),
  };
}

/**
 * Everything the Best Efforts screen paints with over the last `days` days, or
 * all time when `days` is 0. Null before the engine is ready.
 */
export function getBestEffortsData(host: DelegateHost, days: number): FfiBestEffortsData | null {
  if (!host.ready) return null;
  return host.timed('getBestEffortsData', () => host.engine.fitness().getBestEffortsData(days));
}

/** An activity's stored interval body, or null if never fetched. */
export function getIntervalBody(host: DelegateHost, activityId: string): string | null {
  if (!host.ready) return null;
  return (
    (host.timed('getIntervalBody', () => host.engine.fitness().getIntervalBody(activityId)) as
      | string
      | undefined) ?? null
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
      host.engine.fitness().getCalendarEventBodies(oldestTs, newestTs)
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
    host.engine.fitness().getWeeklySummaries(weekStarts, weekLengthSecs)
  );
  return rows;
}

/** A sample library for the widgets: the rows a scratch database is filled with. */
export interface SampleWidgetLibrary {
  athleteJson: string;
  sportSettingsJson: string;
  wellness: WellnessRowInput[];
  activities: FfiActivityBody[];
  /** The sets of the library's strength sessions, each naming its activity. */
  exerciseSets: FfiExerciseSet[];
}

/**
 * The home-screen widget snapshot as the JSON the widgets read, composed by the
 * engine from its rows and `contextJson`, the words and settings only the app
 * knows. Undefined when the engine is not open; a failed read throws, which the
 * caller reads as "unknown" and keeps the last file.
 *
 * With a `sample` the snapshot is composed from that library in a scratch
 * database the engine drops with the call, so the athlete's own database is
 * neither read nor written.
 */
export function composeWidgetSnapshot(
  host: DelegateHost,
  contextJson: string,
  nowSeconds: number,
  nowWallSeconds: number,
  sample?: SampleWidgetLibrary
): string | undefined {
  if (!host.ready) return undefined;
  return host.timed('composeWidgetSnapshot', () =>
    host.engine.fitness().composeWidgetSnapshot(
      contextJson,
      nowSeconds,
      nowWallSeconds,
      sample &&
        present({
          athleteJson: sample.athleteJson,
          sportSettingsJson: sample.sportSettingsJson,
          wellness: sample.wellness.map(wellnessRowToFfi),
          activities: sample.activities,
          exerciseSets: sample.exerciseSets,
        })
    )
  );
}

/**
 * Store the widget context, so the Android push worker composes the snapshot in
 * the app's words with no JavaScript running. Answers whether anything was
 * written; a refused write answers false, and the worker keeps the last context.
 */
export function setWidgetContext(host: DelegateHost, contextJson: string): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('setWidgetContext', () =>
      host.engine.fitness().setWidgetContext(contextJson)
    );
  } catch {
    return false;
  }
}
