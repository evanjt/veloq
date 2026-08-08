/**
 * Widget snapshot: the small, pre-computed, pre-formatted JSON the app writes to
 * shared storage for the home-screen widget to render. Widgets run in a separate
 * process and cannot call the Rust FFI, so everything they show is baked here.
 *
 * `composeSnapshot` is pure (fully unit-tested). `gatherWidgetSnapshot` reads the
 * engine singleton through one `getWidgetSnapshot()` call and is the entry point
 * the write hooks call.
 *
 * Sparkline arrays from `getWellnessSparklines` are ordered OLDEST-FIRST, which
 * is also the order the native charts draw. Rust selects `ORDER BY date DESC`
 * then reverses (`persistence/wellness.rs`), so the LAST element is today and
 * the second-to-last is yesterday.
 */
import { getFormZone, type FormZone } from '@/features/fitness/lib/fitness';
import {
  formatDistance,
  formatDuration,
  formatPaceCompact,
  formatRelativeDate,
  formatSwimPace,
} from '@/shared/format';
import { getRouteEngine } from '@/shared/native/routeEngine';
import type { WidgetSnapshotData } from 'veloqrs';
import { widgetActivityTint, widgetPalette, type WidgetPalette } from '@/shared/theme/widgetTheme';

import { useDashboardPreferences, type SummaryCardPreferences } from '../store';

export const WIDGET_SNAPSHOT_SCHEMA_VERSION = 4;

/** Trailing wellness window the widget sparklines cover. */
const SPARKLINE_DAYS = 30;

export type TrendDir = 'up' | 'down' | 'flat';

export interface MetricValue {
  value: number;
  trendDir: TrendDir;
  /** today minus yesterday (omitted when only one data point exists). */
  deltaVsYesterday?: number;
}

/**
 * The form metric also carries its TSB zone so natives colour by enum lookup and
 * never re-derive the zone boundaries.
 */
export interface FormMetricValue extends MetricValue {
  zone: FormZone;
}

/**
 * Normalised route outline for the latest GPS activity, so the widget can draw a
 * map-free preview. Points are 0..1 [x, y] pairs (y grows downward, screen
 * convention), downsampled to at most ROUTE_PREVIEW_MAX_POINTS.
 */
export interface WidgetRoutePreview {
  points: [number, number][];
  /** Projected bounding-box width divided by height, for letterboxed drawing. */
  aspect: number;
}

export interface WidgetLatest {
  activityId: string;
  name: string;
  sportType: string;
  distanceM: number;
  movingTimeS: number;
  /** Unix seconds. */
  date: number;
  trainingLoad: number | null;
  distanceLabel: string;
  durationLabel: string;
  dateLabel: string;
  /** Resolved sport tint hex, so the widget needs no sport-to-colour map. */
  tintHex: string;
  /** True when this activity set a route or section PR (gold moments only). */
  isPr: boolean;
  /** Null for indoor/no-GPS activities; the widget falls back to text-only. */
  routePreview: WidgetRoutePreview | null;
}

export interface WidgetImpact {
  formBefore: number;
  formAfter: number;
  /** Zones for before/after so natives tint each value without TSB maths. */
  formBeforeZone: FormZone;
  formAfterZone: FormZone;
  ctlDelta: number;
  atlDelta: number;
  tssAdded: number | null;
  dateLabel: string;
}

/** Palette role the natives resolve when tinting a summary entry value. */
export type SummaryColorKey = 'blue' | 'fatigue' | 'formZone' | 'default';

export interface WidgetSummaryEntry {
  /** MetricId from the dashboard preferences store. */
  id: string;
  /** Pre-localized label. */
  label: string;
  /** Pre-formatted value string ("-" when no data). */
  value: string;
  trendDir: TrendDir;
  colorKey: SummaryColorKey;
}

/**
 * Ready-to-render mirror of the in-app summary card, following the settings the
 * user configured in the app. Natives only draw it; the metric selection always
 * tracks the app without any widget-side configuration.
 */
export interface WidgetSummaryCard {
  hero: WidgetSummaryEntry;
  /** Up to 4 supporting entries, in the user's configured order. */
  entries: WidgetSummaryEntry[];
  /** Which snapshot sparkline to draw: 'fitnessForm' | 'hrv' | 'none'. */
  sparkline: string;
}

/**
 * Pre-localized strings the widget renders verbatim, so native code holds no i18n
 * logic. Sourced from existing translation keys (no new locale keys to maintain).
 */
export interface WidgetDisplay {
  metricLabels: {
    form: string;
    fitness: string;
    fatigue: string;
    hrv: string;
    rhr: string;
    ramp: string;
  };
  weekLabel: string;
  /** Localised label for the current form zone (e.g. "Optimal"). */
  formZone: string;
  /** "Form -5 to -8, +62 TSS" style line, or null when there is no recent impact. */
  impactLine: string | null;
}

export interface WidgetSnapshot {
  schemaVersion: number;
  /** Unix seconds. */
  generatedAt: number;
  locale: string;
  metrics: {
    form: FormMetricValue;
    fitness: MetricValue;
    fatigue: MetricValue;
    rampRate: { value: number };
    hrv: MetricValue;
    rhr: MetricValue;
  };
  sparklines: {
    form: number[];
    fitness: number[];
    fatigue: number[];
    hrv: number[];
    /**
     * TSB zone enum per form point (oldest-first, same length as `form`), so
     * natives colour the chart's form bar without re-deriving zone boundaries.
     */
    formZones: FormZone[];
  };
  weekly: {
    tss: number;
    distanceM: number;
    durationS: number;
    count: number;
    /** Percent change vs previous week, or null when last week had no load. */
    deltaPct: number | null;
    distanceLabel: string;
    durationLabel: string;
  };
  latest: WidgetLatest | null;
  impact: WidgetImpact | null;
  /** Null when the summary card is disabled in settings or prefs are unavailable. */
  summaryCard: WidgetSummaryCard | null;
  display: WidgetDisplay;
  theme: { light: WidgetPalette; dark: WidgetPalette };
}

// Minimal structural shapes of the engine returns we consume, kept local so this
// module doesn't couple to FFI type paths and stays trivially testable.
export interface RawSparklines {
  fitness: number[];
  fatigue: number[];
  form: number[];
  hrv: number[];
  rhr: number[];
}
interface RawPeriodStats {
  count: number;
  totalDuration: number | bigint;
  totalDistance: number;
  totalTss: number;
}
export interface RawSummary {
  currentWeek: RawPeriodStats;
  prevWeek: RawPeriodStats;
  ftpTrend?: { latestFtp?: number; previousFtp?: number };
  runPaceTrend?: { latestPace?: number; previousPace?: number };
  swimPaceTrend?: { latestPace?: number; previousPace?: number };
}
export interface RawLatestActivity {
  activityId: string;
  name: string;
  date: number | bigint;
  distance: number;
  movingTime: number;
  trainingLoad?: number | null;
  sportType: string;
  /** From the highlights bundle (route/section PR indicators); defaults false. */
  isPr?: boolean;
}
export interface RawGpsPoint {
  latitude: number;
  longitude: number;
}

export interface RawWidgetData {
  sparklines: RawSparklines | null;
  summary: RawSummary | null;
  latest: RawLatestActivity | null;
  /** GPS track of the latest activity (null for indoor / unavailable). */
  latestGps?: RawGpsPoint[] | null;
  /** In-app summary card settings; null hides the widget summary block. */
  summaryPrefs?: SummaryCardPreferences | null;
  locale: string;
  isMetric: boolean;
  /** Unix seconds, injected for deterministic tests. */
  nowSeconds: number;
  /** i18n lookup; falls back to the raw key when absent (pure-test safe). */
  translate?: (key: string) => string;
}

const FORM_DEADBAND = 1; // CTL/ATL/form points are integers; <1 change reads as flat
const IMPACT_MAX_AGE_DAYS = 2; // only attribute impact to a genuinely recent activity
export const ROUTE_PREVIEW_MAX_POINTS = 150;

function num(v: number | bigint | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'bigint' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function trendOf(today: number, yesterday: number, deadband = FORM_DEADBAND): TrendDir {
  const delta = today - yesterday;
  if (Math.abs(delta) < deadband) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/** Trend between two possibly-missing values; missing data reads as flat. */
function trendOfNullable(
  current: number | null | undefined,
  prev: number | null | undefined,
  deadband: number
): TrendDir {
  if (current == null || prev == null) return 'flat';
  return trendOf(current, prev, deadband);
}

/** Build a MetricValue from an oldest-first series. Safe on empty/short arrays. */
function metricFrom(series: number[], deadband = FORM_DEADBAND): MetricValue {
  if (!series || series.length === 0) return { value: 0, trendDir: 'flat' };
  const today = num(series[series.length - 1]);
  if (series.length === 1) return { value: today, trendDir: 'flat' };
  const yesterday = num(series[series.length - 2]);
  return {
    value: today,
    trendDir: trendOf(today, yesterday, deadband),
    deltaVsYesterday: today - yesterday,
  };
}

/** CTL ramp: change in fitness across the trailing ~7 days of the series. */
function rampRateFrom(fitness: number[]): number {
  if (!fitness || fitness.length < 2) return 0;
  const last = fitness.length - 1;
  const today = num(fitness[last]);
  const past = num(fitness[Math.max(0, last - 6)]);
  return Math.round((today - past) * 10) / 10;
}

/**
 * Pure transform: raw engine data to the widget snapshot. No I/O, no engine, no
 * clock. Everything (including `nowSeconds`) is injected, so this is fully
 * deterministic.
 */
export function composeSnapshot(raw: RawWidgetData): WidgetSnapshot {
  const sp = raw.sparklines;
  const fitness = sp?.fitness ?? [];
  const fatigue = sp?.fatigue ?? [];
  const form = sp?.form ?? [];
  const hrv = sp?.hrv ?? [];
  const rhr = sp?.rhr ?? [];

  const curTss = num(raw.summary?.currentWeek.totalTss);
  const prevTss = num(raw.summary?.prevWeek.totalTss);
  const weeklyDistanceM = num(raw.summary?.currentWeek.totalDistance);
  const weeklyDurationS = num(raw.summary?.currentWeek.totalDuration);
  const deltaPct = prevTss > 0 ? Math.round(((curTss - prevTss) / prevTss) * 100) : null;

  const latest = composeLatest(raw);
  const impact = composeImpact(raw, fitness, fatigue, form, latest);
  const t = raw.translate ?? ((k: string) => k);

  return {
    schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: raw.nowSeconds,
    locale: raw.locale,
    metrics: {
      form: formMetricFrom(form),
      fitness: metricFrom(fitness),
      fatigue: metricFrom(fatigue),
      rampRate: { value: rampRateFrom(fitness) },
      hrv: metricFrom(hrv),
      rhr: metricFrom(rhr),
    },
    sparklines: {
      // Already oldest-first from Rust, which is how the native chart draws.
      form: [...form],
      fitness: [...fitness],
      fatigue: [...fatigue],
      hrv: [...hrv],
      formZones: form.map((v) => getFormZone(num(v))),
    },
    weekly: {
      tss: Math.round(curTss),
      distanceM: weeklyDistanceM,
      durationS: weeklyDurationS,
      count: num(raw.summary?.currentWeek.count),
      deltaPct,
      distanceLabel: formatDistance(weeklyDistanceM, raw.isMetric),
      durationLabel: formatDuration(weeklyDurationS),
    },
    latest,
    impact,
    summaryCard: composeSummaryCard(raw, t),
    display: buildDisplay(t, impact, getFormZone(num(form[form.length - 1]))),
    theme: { light: widgetPalette.light, dark: widgetPalette.dark },
  };
}

/** Form metric with its zone, so natives colour by enum and never do TSB maths. */
function formMetricFrom(series: number[]): FormMetricValue {
  const base = metricFrom(series);
  return { ...base, zone: getFormZone(base.value) };
}

/**
 * The widget mirror of the in-app summary card. Built from the same preferences
 * store the settings screen writes, so the widget always tracks the app config.
 * Weight is omitted: its source (wellness weight) isn't part of the gather path.
 */
function composeSummaryCard(
  raw: RawWidgetData,
  t: (key: string) => string
): WidgetSummaryCard | null {
  const prefs = raw.summaryPrefs;
  if (!prefs || !prefs.enabled) return null;

  const entryFor = (id: string): WidgetSummaryEntry | null => {
    const sp = raw.sparklines;
    const summary = raw.summary;
    switch (id) {
      case 'fitness': {
        const m = metricFrom(sp?.fitness ?? []);
        return {
          id,
          label: t('metrics.fitness'),
          value: fmtInt(m),
          trendDir: m.trendDir,
          colorKey: 'blue',
        };
      }
      case 'form': {
        const m = metricFrom(sp?.form ?? [], 2);
        const v = Math.round(m.value);
        return {
          id,
          label: t('metrics.form'),
          value: sp ? (v > 0 ? `+${v}` : String(v)) : '-',
          trendDir: m.trendDir,
          colorKey: 'formZone',
        };
      }
      case 'hrv': {
        const m = metricFrom(sp?.hrv ?? [], 2);
        return {
          id,
          label: t('metrics.hrv'),
          value: fmtSeries(sp?.hrv, m),
          trendDir: m.trendDir,
          colorKey: 'default',
        };
      }
      case 'rhr': {
        const m = metricFrom(sp?.rhr ?? []);
        return {
          id,
          label: t('metrics.rhr'),
          value: fmtSeries(sp?.rhr, m),
          trendDir: m.trendDir,
          colorKey: 'default',
        };
      }
      case 'weekHours': {
        const hours = Math.round((num(summary?.currentWeek.totalDuration) / 3600) * 10) / 10;
        const prevHours = Math.round((num(summary?.prevWeek.totalDuration) / 3600) * 10) / 10;
        return {
          id,
          label: t('metrics.week'),
          value: `${hours}h`,
          trendDir: trendOf(hours, prevHours, 0.5),
          colorKey: 'default',
        };
      }
      case 'weekCount': {
        const count = num(summary?.currentWeek.count);
        return {
          id,
          label: '#',
          value: String(count),
          trendDir: trendOf(count, num(summary?.prevWeek.count), 1),
          colorKey: 'default',
        };
      }
      case 'ftp': {
        const latestFtp = summary?.ftpTrend?.latestFtp ?? null;
        return {
          id,
          label: t('metrics.ftp'),
          value: latestFtp == null ? '-' : String(Math.round(latestFtp)),
          trendDir: trendOfNullable(latestFtp, summary?.ftpTrend?.previousFtp, 2),
          colorKey: 'default',
        };
      }
      case 'thresholdPace': {
        const pace = summary?.runPaceTrend?.latestPace ?? null;
        return {
          id,
          label: t('metrics.pace'),
          value: pace == null || pace <= 0 ? '-' : formatPaceCompact(pace, raw.isMetric),
          trendDir: trendOfNullable(pace, summary?.runPaceTrend?.previousPace, 0.05),
          colorKey: 'default',
        };
      }
      case 'css': {
        const pace = summary?.swimPaceTrend?.latestPace ?? null;
        return {
          id,
          label: t('metrics.css'),
          value: pace == null || pace <= 0 ? '-' : formatSwimPace(pace, raw.isMetric),
          trendDir: trendOfNullable(pace, summary?.swimPaceTrend?.previousPace, 0.05),
          colorKey: 'default',
        };
      }
      default:
        return null;
    }
  };

  const hero = entryFor(prefs.heroMetric) ?? entryFor('fitness');
  if (!hero) return null;

  const entries = prefs.supportingMetrics
    .map((id) => entryFor(id))
    .filter((e): e is WidgetSummaryEntry => e != null)
    .slice(0, 4);

  const sparkline = !prefs.showSparkline
    ? 'none'
    : prefs.heroMetric === 'hrv'
      ? 'hrv'
      : 'fitnessForm';
  return { hero, entries, sparkline };
}

function fmtInt(m: MetricValue): string {
  return String(Math.round(m.value));
}

/** "-" when the series has no data at all (metricFrom's 0 would be misleading). */
function fmtSeries(series: number[] | undefined, m: MetricValue): string {
  if (!series || series.length === 0) return '-';
  return String(Math.round(m.value));
}

/** Pre-localized label strings + the impact sentence, from existing i18n keys. */
function buildDisplay(
  t: (key: string) => string,
  impact: WidgetImpact | null,
  formZone: FormZone
): WidgetDisplay {
  const formLabel = t('metrics.form');
  return {
    metricLabels: {
      form: formLabel,
      fitness: t('metrics.fitness'),
      fatigue: t('metrics.fatigue'),
      hrv: t('metrics.hrv'),
      rhr: t('metrics.rhr'),
      ramp: t('fitnessScreen.rampRate'),
    },
    weekLabel: t('metrics.week'),
    formZone: t(`formZones.${formZone}`),
    impactLine: impact ? formatImpactLine(formLabel, impact) : null,
  };
}

function formatImpactLine(formLabel: string, impact: WidgetImpact): string {
  const before = Math.round(impact.formBefore);
  const after = Math.round(impact.formAfter);
  let line = `${formLabel} ${before} → ${after}`;
  if (impact.tssAdded != null) {
    const tss = Math.round(impact.tssAdded);
    line += ` · ${tss >= 0 ? '+' : ''}${tss} TSS`;
  }
  return line;
}

function composeLatest(raw: RawWidgetData): WidgetLatest | null {
  const a = raw.latest;
  if (!a) return null;
  const date = num(a.date);
  const distanceM = num(a.distance);
  const movingTimeS = num(a.movingTime);
  return {
    activityId: a.activityId,
    name: a.name,
    sportType: a.sportType,
    distanceM,
    movingTimeS,
    date,
    trainingLoad: a.trainingLoad == null ? null : num(a.trainingLoad),
    distanceLabel: formatDistance(distanceM, raw.isMetric),
    durationLabel: formatDuration(movingTimeS),
    dateLabel: relativeDateLabel(date),
    tintHex: widgetActivityTint(a.sportType),
    isPr: a.isPr === true,
    routePreview: composeRoutePreview(raw.latestGps),
  };
}

/**
 * Project and normalise a GPS track into a 0..1 drawing box. Equirectangular
 * projection (x scaled by cos of the mid latitude) keeps the shape visually
 * faithful at route scale; y is flipped so it grows downward like screen pixels.
 */
export function composeRoutePreview(
  gps: RawGpsPoint[] | null | undefined
): WidgetRoutePreview | null {
  if (!gps || gps.length < 2) return null;

  const stride = Math.max(1, Math.ceil(gps.length / ROUTE_PREVIEW_MAX_POINTS));
  const sampled: RawGpsPoint[] = [];
  for (let i = 0; i < gps.length; i += stride) {
    const p = gps[i];
    if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) sampled.push(p);
  }
  const last = gps[gps.length - 1];
  if (
    sampled.length > 0 &&
    sampled[sampled.length - 1] !== last &&
    Number.isFinite(last.latitude) &&
    Number.isFinite(last.longitude)
  ) {
    sampled.push(last);
  }
  if (sampled.length < 2) return null;

  const midLat = (sampled[0].latitude + sampled[sampled.length - 1].latitude) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const projected = sampled.map((p) => {
    const x = p.longitude * lonScale;
    const y = p.latitude;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    return { x, y };
  });

  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) && !(h > 0)) return null;
  const safeW = w > 0 ? w : 1;
  const safeH = h > 0 ? h : 1;

  const points: [number, number][] = projected.map((p) => [
    round3((p.x - minX) / safeW),
    round3(1 - (p.y - minY) / safeH),
  ]);
  const aspect = h > 0 ? Math.max(0.1, Math.min(10, w / h)) : 1;
  return { points, aspect: Math.round(aspect * 100) / 100 };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function composeImpact(
  raw: RawWidgetData,
  fitness: number[],
  fatigue: number[],
  form: number[],
  latest: WidgetLatest | null
): WidgetImpact | null {
  if (!latest) return null;
  if (form.length < 2 || fitness.length < 2 || fatigue.length < 2) return null;
  const ageDays = (raw.nowSeconds - latest.date) / 86400;
  if (ageDays < 0 || ageDays > IMPACT_MAX_AGE_DAYS) return null;
  // Oldest-first: today is the last element, yesterday the one before it.
  const today = form.length - 1;
  const formAfter = num(form[today]);
  const formBefore = num(form[today - 1]);
  return {
    formBefore,
    formAfter,
    formBeforeZone: getFormZone(formBefore),
    formAfterZone: getFormZone(formAfter),
    ctlDelta: num(fitness[fitness.length - 1]) - num(fitness[fitness.length - 2]),
    atlDelta: num(fatigue[fatigue.length - 1]) - num(fatigue[fatigue.length - 2]),
    tssAdded: latest.trainingLoad,
    dateLabel: latest.dateLabel,
  };
}

/** Relative date label from a unix-seconds timestamp, guarded against bad input. */
function relativeDateLabel(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return '';
  const iso = new Date(unixSeconds * 1000).toISOString().slice(0, 10);
  return formatRelativeDate(iso);
}

/**
 * Read the engine and build the snapshot. Returns null when the engine isn't ready
 * (e.g. very early startup) so callers can no-op.
 */
export function gatherWidgetSnapshot(opts: {
  locale: string;
  isMetric: boolean;
  now?: Date;
  translate?: (key: string) => string;
}): WidgetSnapshot | null {
  const engine = getRouteEngine();
  if (!engine) return null;

  const now = opts.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);

  let data: WidgetSnapshotData | undefined;
  try {
    const b = weekBounds(now);
    data = engine.getWidgetSnapshot(
      b.currentStart,
      b.currentEnd,
      b.prevStart,
      b.prevEnd,
      SPARKLINE_DAYS
    );
  } catch {
    data = undefined;
  }

  let summaryPrefs: SummaryCardPreferences | null = null;
  try {
    summaryPrefs = useDashboardPreferences.getState().summaryCard;
  } catch {
    summaryPrefs = null;
  }

  const latest = data?.latest
    ? ({ ...data.latest, isPr: data.latestIsPr } as RawLatestActivity)
    : null;

  return composeSnapshot({
    sparklines: (data?.sparklines as RawSparklines | undefined) ?? null,
    summary: (data?.summary as RawSummary | undefined) ?? null,
    latest,
    latestGps: latest ? ((data?.latestGps as RawGpsPoint[]) ?? null) : null,
    summaryPrefs,
    locale: opts.locale,
    isMetric: opts.isMetric,
    nowSeconds,
    translate: opts.translate,
  });
}

/** Current and previous ISO-week (Monday to today) bounds, mirroring useStartupData. */
function weekBounds(now: Date): {
  currentStart: number;
  currentEnd: number;
  prevStart: number;
  prevEnd: number;
} {
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - day + (day === 0 ? -6 : 1));
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const toTs = (d: Date) => Math.floor(d.getTime() / 1000);
  return {
    currentStart: toTs(startOfWeek),
    currentEnd: toTs(now),
    prevStart: toTs(startOfLastWeek),
    prevEnd: toTs(startOfWeek),
  };
}
