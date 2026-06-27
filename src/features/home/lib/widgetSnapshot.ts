/**
 * Widget snapshot — the small, pre-computed, pre-formatted JSON the app writes to
 * shared storage for the home-screen widget to render. Widgets run in a separate
 * process and cannot call the Rust FFI, so everything they show is baked here.
 *
 * `composeSnapshot` is pure (fully unit-tested). `gatherWidgetSnapshot` reads the
 * engine singleton and is the entry point the write hooks call. A consolidating
 * Rust `getWidgetSnapshot()` FFI will later replace the multi-call gather, but the
 * snapshot shape it returns stays the same.
 *
 * Sparkline arrays from `getWellnessSparklines` are ordered NEWEST-FIRST
 * (`ORDER BY date DESC`), so index 0 = today, index 1 = yesterday.
 */
import { formatDistance, formatDuration, formatRelativeDate } from '@/shared/format';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { widgetActivityTint, widgetPalette, type WidgetPalette } from '@/shared/theme/widgetTheme';

export const WIDGET_SNAPSHOT_SCHEMA_VERSION = 2;

export type TrendDir = 'up' | 'down' | 'flat';

export interface MetricValue {
  value: number;
  trendDir: TrendDir;
  /** today − yesterday (omitted when only one data point exists). */
  deltaVsYesterday?: number;
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
  /** Resolved sport tint hex, so the widget needs no sport→colour map. */
  tintHex: string;
}

export interface WidgetImpact {
  formBefore: number;
  formAfter: number;
  ctlDelta: number;
  atlDelta: number;
  tssAdded: number | null;
  dateLabel: string;
}

/**
 * Pre-localized strings the widget renders verbatim, so native code holds no i18n
 * logic. Sourced from existing translation keys (no new locale keys to maintain).
 */
export interface WidgetDisplay {
  metricLabels: { form: string; fitness: string; fatigue: string; hrv: string; rhr: string };
  weekLabel: string;
  /** "Form −5 → −8 · +62 TSS", or null when there is no recent impact. */
  impactLine: string | null;
}

export interface WidgetSnapshot {
  schemaVersion: number;
  /** Unix seconds. */
  generatedAt: number;
  locale: string;
  metrics: {
    form: MetricValue;
    fitness: MetricValue;
    fatigue: MetricValue;
    rampRate: { value: number };
    hrv: MetricValue;
    rhr: MetricValue;
  };
  sparklines: { form: number[]; fitness: number[]; hrv: number[] };
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
  display: WidgetDisplay;
  theme: { light: WidgetPalette; dark: WidgetPalette };
}

// Minimal structural shapes of the engine returns we consume — kept local so this
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
}
export interface RawLatestActivity {
  activityId: string;
  name: string;
  date: number | bigint;
  distance: number;
  movingTime: number;
  trainingLoad?: number | null;
  sportType: string;
}

export interface RawWidgetData {
  sparklines: RawSparklines | null;
  summary: RawSummary | null;
  latest: RawLatestActivity | null;
  locale: string;
  isMetric: boolean;
  /** Unix seconds — injected for deterministic tests. */
  nowSeconds: number;
  /** i18n lookup; falls back to the raw key when absent (pure-test safe). */
  translate?: (key: string) => string;
}

const FORM_DEADBAND = 1; // CTL/ATL/form points are integers; <1 change reads as flat
const IMPACT_MAX_AGE_DAYS = 2; // only attribute impact to a genuinely recent activity

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

/** Build a MetricValue from a newest-first series. Safe on empty/short arrays. */
function metricFrom(series: number[], deadband = FORM_DEADBAND): MetricValue {
  if (!series || series.length === 0) return { value: 0, trendDir: 'flat' };
  const today = num(series[0]);
  if (series.length === 1) return { value: today, trendDir: 'flat' };
  const yesterday = num(series[1]);
  return {
    value: today,
    trendDir: trendOf(today, yesterday, deadband),
    deltaVsYesterday: today - yesterday,
  };
}

/** CTL ramp: change in fitness across the trailing ~7 days of the series. */
function rampRateFrom(fitness: number[]): number {
  if (!fitness || fitness.length < 2) return 0;
  const today = num(fitness[0]);
  const past = num(fitness[Math.min(6, fitness.length - 1)]);
  return Math.round((today - past) * 10) / 10;
}

/**
 * Pure transform: raw engine data → the widget snapshot. No I/O, no engine, no clock
 * — everything (including `nowSeconds`) is injected, so this is fully deterministic.
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

  return {
    schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: raw.nowSeconds,
    locale: raw.locale,
    metrics: {
      form: metricFrom(form),
      fitness: metricFrom(fitness),
      fatigue: metricFrom(fatigue),
      rampRate: { value: rampRateFrom(fitness) },
      hrv: metricFrom(hrv),
      rhr: metricFrom(rhr),
    },
    sparklines: {
      // Reverse to oldest-first so the native sparkline draws left→right in time.
      form: [...form].reverse(),
      fitness: [...fitness].reverse(),
      hrv: [...hrv].reverse(),
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
    display: buildDisplay(raw.translate ?? ((k) => k), impact),
    theme: { light: widgetPalette.light, dark: widgetPalette.dark },
  };
}

/** Pre-localized label strings + the impact sentence, from existing i18n keys. */
function buildDisplay(t: (key: string) => string, impact: WidgetImpact | null): WidgetDisplay {
  const formLabel = t('metrics.form');
  return {
    metricLabels: {
      form: formLabel,
      fitness: t('metrics.fitness'),
      fatigue: t('metrics.fatigue'),
      hrv: t('metrics.hrv'),
      rhr: t('metrics.rhr'),
    },
    weekLabel: t('metrics.week'),
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
  };
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
  return {
    formBefore: num(form[1]),
    formAfter: num(form[0]),
    ctlDelta: num(fitness[0]) - num(fitness[1]),
    atlDelta: num(fatigue[0]) - num(fatigue[1]),
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
 * (e.g. very early startup) so callers can no-op. The multi-call gather here is the
 * Phase-1 path; a consolidating `getWidgetSnapshot()` FFI supersedes it later.
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

  let sparklines: RawSparklines | null = null;
  let summary: RawSummary | null = null;
  let latest: RawLatestActivity | null = null;

  try {
    sparklines = engine.getWellnessSparklines?.(30) ?? null;
  } catch {
    sparklines = null;
  }

  try {
    const b = weekBounds(now);
    summary =
      (engine.getSummaryCardData?.(
        b.currentStart,
        b.currentEnd,
        b.prevStart,
        b.prevEnd
      ) as RawSummary) ?? null;
  } catch {
    summary = null;
  }

  try {
    const ids = engine.getActivityIds?.() ?? [];
    if (ids.length > 0) {
      const metrics = (engine.getActivityMetricsForIds?.(ids) ?? []) as RawLatestActivity[];
      latest = mostRecent(metrics);
    }
  } catch {
    latest = null;
  }

  return composeSnapshot({
    sparklines,
    summary,
    latest,
    locale: opts.locale,
    isMetric: opts.isMetric,
    nowSeconds,
    translate: opts.translate,
  });
}

function mostRecent(metrics: RawLatestActivity[]): RawLatestActivity | null {
  let best: RawLatestActivity | null = null;
  let bestDate = -Infinity;
  for (const m of metrics) {
    const d = num(m.date);
    if (d > bestDate) {
      bestDate = d;
      best = m;
    }
  }
  return best;
}

/** Current and previous ISO-week (Mon–today) bounds, mirroring useStartupData. */
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
