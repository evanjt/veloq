/**
 * A stand-in for the engine's fitness screen read, its calendar parts
 * assembled from one fixture per part, each asked over the window the read
 * names for it, and its trend, speeds and strip empty. A suite keeps its
 * per-part fixture and asserts on it, while the screen makes the one call.
 *
 *   const heatmapDays = jest.fn(() => [{ date: today, intensity: 3, ... }]);
 *   const engine = { getFitnessScreenData: fitnessScreenRead({ heatmap: heatmapDays }) };
 */
import {
  RangeCoverage,
  type FitnessScreenData,
  type FitnessScreenWindows,
  type HeatmapDay,
  type MonthlyStats,
  type PeriodStats,
  type StatTrend,
  type SummaryComparison,
} from 'veloqrs';

type Comparisons = FitnessScreenData['comparisons'];

interface Parts {
  heatmap?: (firstDay: string, lastDay: string) => HeatmapDay[];
  /**
   * The calendar's first drawn day given the most it may draw, and the older
   * activities owed. By default it draws the most, with none owed.
   */
  calendarFirstDay?: (capDay: string) => string;
  calendarOlderOwed?: number;
  months?: (startTs: number, endTs: number) => MonthlyStats[];
  period?: (startTs: number, endTs: number) => PeriodStats;
  /** The weekly card's ranges, given the instant the read runs to. */
  comparisons?: (nowWallSeconds: number) => Partial<Comparisons>;
  /**
   * The census answer for a period, which the season comparisons carry and
   * withhold their changes on. Every period is downloaded by default.
   */
  coverage?: (startTs: number, endTs: number) => RangeCoverage;
}

/** A move given in a fixture, whose unrounded change defaults to none. */
type Move = Omit<StatTrend, 'change'> & { change?: number };
const move = (m: Move): StatTrend => ({ ...m, change: m.change ?? 0 });

export const NO_TOTALS: PeriodStats = {
  count: 0,
  totalDuration: 0,
  totalDistance: 0,
  totalTss: 0,
};

/** Midnight of a local date, in the engine's wall-clock seconds. */
export function wallSeconds(date: Date): number {
  return Math.floor(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    ) / 1000
  );
}

/** One comparison, every window and total defaulted to an empty one at `now`. */
export function summaryComparison(
  now: number,
  part: Partial<SummaryComparison> & { moves?: Partial<Record<string, Move>> } = {}
): SummaryComparison {
  const { moves, ...rest } = part;
  return {
    current: { startTs: now, endTs: now },
    previous: { startTs: now, endTs: now },
    currentStats: NO_TOTALS,
    previousStats: NO_TOTALS,
    currentCoverage: RangeCoverage.Loaded,
    previousCoverage: RangeCoverage.Loaded,
    ...(moves?.count && { count: move(moves.count) }),
    ...(moves?.duration && { duration: move(moves.duration) }),
    ...(moves?.distance && { distance: move(moves.distance) }),
    ...(moves?.load && { load: move(moves.load) }),
    ...rest,
  };
}

type Range = { startTs: number; endTs: number };

/**
 * A season comparison as the engine judges one: each total's signed change
 * against a positive earlier total, and none while either period is owed.
 */
function seasonComparison(
  current: Range,
  previous: Range,
  totals: (range: Range) => PeriodStats,
  coverage: (range: Range) => RangeCoverage
): SummaryComparison {
  const [c, p] = [totals(current), totals(previous)];
  const [currentCoverage, previousCoverage] = [coverage(current), coverage(previous)];
  const whole =
    currentCoverage !== RangeCoverage.NotFetched && previousCoverage !== RangeCoverage.NotFetched;
  const judge = (now: number, before: number): StatTrend | undefined => {
    if (!whole || !(before > 0)) return undefined;
    const change = ((now - before) / before) * 100;
    return {
      glyph: change > 0 ? '↑' : change < 0 ? '↓' : '→',
      percent: Math.round(Math.abs(change)),
      change,
    };
  };
  const trends = {
    count: judge(c.count, p.count),
    duration: judge(c.totalDuration, p.totalDuration),
    distance: judge(c.totalDistance, p.totalDistance),
    load: judge(c.totalTss, p.totalTss),
  };
  return {
    current,
    previous,
    currentStats: c,
    previousStats: p,
    currentCoverage,
    previousCoverage,
    ...Object.fromEntries(Object.entries(trends).filter(([, t]) => t)),
  };
}

const DAY_SECONDS = 86_400;

/**
 * The year and the month to date at `now`, each against the same elapsed days
 * of the year before and never past that year's or month's last day, as the
 * engine names them from the instant alone.
 */
function seasonWindows(now: number) {
  const at = new Date(now * 1000);
  const [year, month] = [at.getUTCFullYear(), at.getUTCMonth()];
  const today = Date.UTC(year, month, at.getUTCDate()) / 1000;
  const window = (first: number, previousFirst: number, previousLast: number) => ({
    current: { startTs: first, endTs: today + DAY_SECONDS - 1 },
    previous: {
      startTs: previousFirst,
      endTs: Math.min(previousFirst + (today - first), previousLast) + DAY_SECONDS - 1,
    },
  });
  const yearWindow = window(
    Date.UTC(year, 0, 1) / 1000,
    Date.UTC(year - 1, 0, 1) / 1000,
    Date.UTC(year - 1, 11, 31) / 1000
  );
  const monthWindow = window(
    Date.UTC(year, month, 1) / 1000,
    Date.UTC(year - 1, month, 1) / 1000,
    Date.UTC(year - 1, month + 1, 0) / 1000
  );
  return { year: yearWindow, month: monthWindow };
}

/** Whole months of this year before the current one, then the month to date. */
function seasonMonthRanges(now: number): [Range, Range][] {
  const { month } = seasonWindows(now);
  const monthStart = new Date(month.current.startTs * 1000);
  const year = monthStart.getUTCFullYear();
  const whole = (y: number, m: number): Range => ({
    startTs: Date.UTC(y, m, 1) / 1000,
    endTs: Date.UTC(y, m + 1, 1) / 1000 - 1,
  });
  const past: [Range, Range][] = Array.from({ length: monthStart.getUTCMonth() }, (_, m) => [
    whole(year, m),
    whole(year - 1, m),
  ]);
  return [...past, [month.current, month.previous]];
}

/** The weekly card's every range with nothing in it, at `now`. */
export function noComparisons(now: number): Comparisons {
  const empty = summaryComparison(now);
  return { week: empty, month: empty, threeMonths: empty, sixMonths: empty, year: empty };
}

/** The calendar parts with nothing in them, the weekly card's ranges at `now`. */
export function noCalendarParts(now = 0) {
  return {
    heatmap: [],
    // No day, so the calendar keeps the most it draws.
    calendarFirstDay: '',
    calendarOlderOwed: 0,
    months: [],
    seasonYear: summaryComparison(now),
    seasonMonths: [],
    comparisons: noComparisons(now),
  };
}

/** The parts the calendar cards do not paint, with nothing in them. */
export const NO_FITNESS_PARTS = {
  ftpTrend: { lookbackDays: 0, sampleCount: 0, history: [], historyDays: [], changes: [] },
  ftpTrendCoverage: RangeCoverage.NotFetched,
  thresholdPaces: [],
  sportMix: { rides: 0, runs: 0, swims: 0 },
  fitnessDays: 42,
  fatigueDays: 7,
  decouplingSources: [],
  loadDots: [],
  weeklyHours: [],
  uncountedImports: 0,
};

export function fitnessScreenRead(parts: Parts) {
  const totals = (range: Range) => parts.period?.(range.startTs, range.endTs) ?? NO_TOTALS;
  const coverage = (range: Range) =>
    parts.coverage?.(range.startTs, range.endTs) ?? RangeCoverage.Loaded;
  return jest.fn((_spanDays: number[], w: FitnessScreenWindows): FitnessScreenData => {
    const now = w.nowWallSeconds;
    const firstDay = parts.calendarFirstDay?.(w.heatmapFirstDay) ?? w.heatmapFirstDay;
    return {
      ...NO_FITNESS_PARTS,
      heatmap: parts.heatmap?.(firstDay, w.heatmapLastDay) ?? [],
      calendarFirstDay: firstDay,
      calendarOlderOwed: parts.calendarOlderOwed ?? 0,
      months: parts.months?.(w.months.startTs, w.months.endTs) ?? [],
      seasonYear: seasonComparison(
        seasonWindows(now).year.current,
        seasonWindows(now).year.previous,
        totals,
        coverage
      ),
      seasonMonths: seasonMonthRanges(now).map(([current, previous]) =>
        seasonComparison(current, previous, totals, coverage)
      ),
      comparisons: { ...noComparisons(now), ...parts.comparisons?.(now) },
    };
  });
}
