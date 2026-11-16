// The chart kit's arithmetic: margins from measured labels, the plot box, value
// and time axes with tick labels that never overlap, a stack of lanes on one x
// domain, brushing, and the bins, trend and calendar the other kinds draw. Pure,
// so a test drives it without a browser. Extents, tick steps and curve paths
// come from the app's shared chart modules.

import { niceScale } from '@/shared/charts/axisLabels';
import { finiteExtent } from '@/shared/charts/extent';

export type Box = { left: number; right: number; top: number; bottom: number };
export type Margins = Box;

/** Every chart's text is this size in pixels, whatever the width of its card. */
export const TEXT_PX = 12;

/** The least space between two tick labels on one axis. */
const LABEL_GAP = 6;
/** Between a tick label and its axis. */
const TICK_GAP = 8;
/** Ascent and descent of the chart font's line box, Manrope's 1.066 and 0.3 em, rounded up. */
const ASCENT_PX = 13;
const DESCENT_PX = 4;
/** The space kept between two text boxes that share an axis. */
const BOX_GAP = 2;

/** The x tick labels' baseline, below the plot's bottom edge. */
export const TICK_ROW = TEXT_PX + 2;
/** The x title's baseline below the plot's bottom edge, clear of the tick labels by BOX_GAP. */
export const X_TITLE_ROW = TICK_ROW + DESCENT_PX + BOX_GAP + ASCENT_PX;
/**
 * The y title's baseline, above the plot's top edge: its box clears the top
 * value label, which hangs about 9 px above its tick.
 */
export const Y_TITLE_RISE = 16;
/** The height of a lane's plot in a stack. */
export const LANE_HEIGHT = 96;
/** Below a lane's plot, before the next lane's title. */
const LANE_PAD = 8;

/** The width of a string in pixels at the chart's text size. */
export type Measure = (text: string) => number;

const NARROW = new Set(['.', ',', ':', ';', "'", '’', '|', '!', ' ', '-', '−', 'i', 'l', 'I']);
const WIDE = new Set(['M', 'W', 'm', 'w', '%']);

/**
 * A width for text where no canvas measures it, tabular figures at 0.62 em and
 * the rest sized by class. Wide enough that a label placed with it fits in a
 * real font, so a test and a server render agree with the browser's layout.
 */
export const estimateWidth: Measure = (text) => {
  let em = 0;
  for (const char of text) {
    em += /[0-9]/.test(char) ? 0.62 : NARROW.has(char) ? 0.34 : WIDE.has(char) ? 0.92 : 0.62;
  }
  return em * TEXT_PX;
};

/** `text` cut with an ellipsis until it measures no more than `max`. */
export function fitText(text: string, max: number, measure: Measure): string {
  if (measure(text) <= max) return text;
  const chars = [...text];
  while (chars.length > 0) {
    chars.pop();
    const cut = `${chars.join('').trimEnd()}…`;
    if (measure(cut) <= max) return cut;
  }
  return '';
}

/**
 * The room the axes take from each edge of the drawing, measured from the
 * value labels rather than guessed: the widest label and its gap on the left,
 * a row of tick labels below, and a row for each title that is set.
 */
export function chartMargins(input: {
  yLabels: readonly string[];
  measure: Measure;
  xTitle?: boolean;
  yTitle?: boolean;
}): Margins {
  const widest = input.yLabels.reduce((most, label) => Math.max(most, input.measure(label)), 0);
  return {
    left: Math.ceil(widest) + TICK_GAP,
    right: 12,
    top: input.yTitle ? Y_TITLE_RISE + ASCENT_PX : 8,
    bottom: input.xTitle ? X_TITLE_ROW + DESCENT_PX : TEXT_PX + 10,
  };
}

/** The plot box of a drawing of the given size, its edges coordinates inside the drawing. */
export function plotBox(width: number, height: number, margins: Margins): Box {
  const left = margins.left;
  return {
    left,
    right: Math.max(left + 1, width - margins.right),
    top: margins.top,
    bottom: Math.max(margins.top + 1, height - margins.bottom),
  };
}

export type ValueAxis = { low: number; high: number; ticks: number[] };

/**
 * A value axis over every finite value, rounded out to 1, 2 or 5 times a power
 * of ten. `zero` pins the low end at or below zero, which bars and areas need
 * for their length to mean something.
 */
export function valueAxis(values: readonly number[], zero: boolean, intervals = 4): ValueAxis {
  const extent = finiteExtent(values);
  const low = extent ? (zero ? Math.min(0, extent.min) : extent.min) : 0;
  const high = extent ? (zero ? Math.max(0, extent.max) : extent.max) : 1;
  const scale = niceScale([low, high], intervals);
  return { low: scale.domain[0], high: scale.domain[1], ticks: scale.ticks };
}

/** Pixel y of `value` on `axis` inside the plot. */
export function yOf(value: number, axis: ValueAxis, box: Box): number {
  const span = axis.high - axis.low;
  if (span <= 0) return box.bottom;
  return box.bottom - ((value - axis.low) / span) * (box.bottom - box.top);
}

/** Pixel x of category `index` of `count`, bars and dots centred in their band. */
export function xOfIndex(index: number, count: number, band: boolean, box: Box): number {
  const width = box.right - box.left;
  if (band) return box.left + ((index + 0.5) / Math.max(count, 1)) * width;
  return box.left + (count <= 1 ? 0.5 : index / (count - 1)) * width;
}

/** The category nearest a pointer `x` pixels from the drawing's left edge, clamped. */
export function indexAtPointer(x: number, count: number, band: boolean, box: Box): number {
  if (count <= 0) return -1;
  const width = box.right - box.left;
  const fraction = Math.min(1, Math.max(0, (x - box.left) / width));
  const near = band ? Math.floor(fraction * count) : Math.round(fraction * (count - 1));
  return Math.min(count - 1, Math.max(0, near));
}

/** A linear x axis: a value's pixel and a pixel's value. */
export type XScale = {
  domain: [number, number];
  left: number;
  right: number;
  position: (value: number) => number;
  value: (pixel: number) => number;
};

export function linearX(domain: [number, number], left: number, right: number): XScale {
  const span = domain[1] - domain[0];
  const width = right - left;
  return {
    domain,
    left,
    right,
    position: (value) =>
      span <= 0 ? left + width / 2 : left + ((value - domain[0]) / span) * width,
    value: (pixel) => (width <= 0 ? domain[0] : domain[0] + ((pixel - left) / width) * span),
  };
}

/** The index of the sample nearest `target` in `xs`, which do not decrease; -1 for none. */
export function nearestIndex(xs: readonly number[], target: number): number {
  if (xs.length === 0) return -1;
  let low = 0;
  let high = xs.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((xs[mid] ?? Infinity) < target) low = mid + 1;
    else high = mid;
  }
  const before = low - 1;
  if (before >= 0 && target - (xs[before] ?? target) <= (xs[low] ?? target) - target) return before;
  return low;
}

// --- Tick labels -----------------------------------------------------------

export type Placed = { index: number; left: number; width: number };

/**
 * Where each tick label goes: centred on its tick, shifted to stay inside
 * `min` to `max`, and thinned by a whole stride until no two are within `gap`
 * of each other. The first label is always kept.
 */
export function placeLabels(
  centres: readonly number[],
  widths: readonly number[],
  min: number,
  max: number,
  gap: number
): Placed[] {
  const place = (index: number): Placed => {
    const width = widths[index] ?? 0;
    const wanted = (centres[index] ?? 0) - width / 2;
    return { index, width, left: Math.max(min, Math.min(wanted, max - width)) };
  };
  const collide = (placed: Placed[]) =>
    placed.some((a, i) => {
      const b = placed[i + 1];
      return b !== undefined && a.left + a.width + gap > b.left;
    });
  for (let stride = 1; stride < centres.length; stride++) {
    const placed: Placed[] = [];
    for (let i = 0; i < centres.length; i += stride) placed.push(place(i));
    if (!collide(placed)) return placed;
  }
  return centres.length > 0 ? [place(0)] : [];
}

export type CategoryTick = { index: number; label: string; x: number; left: number; width: number };

/**
 * Labels for categories at `centres`, thinned by a whole stride until none
 * touches its neighbour and all lie inside `min` to `width`.
 */
export function categoryTicks(
  labels: readonly string[],
  centres: readonly number[],
  width: number,
  measure: Measure,
  min = 0
): CategoryTick[] {
  const widths = labels.map((label) => Math.ceil(measure(label)));
  return placeLabels(centres, widths, min, width, LABEL_GAP).map((p) => ({
    index: p.index,
    label: labels[p.index] ?? '',
    x: centres[p.index] ?? 0,
    left: p.left,
    width: p.width,
  }));
}

export type Tick = { value: number; label: string };
export type PlacedTick = Tick & { x: number; left: number; width: number };

const HOUR = 3_600_000;
const DAY = 86_400_000;

type TimeStep = { unit: 'hour' | 'day' | 'week' | 'month' | 'year'; every: number };

const TIME_STEPS: TimeStep[] = [
  ...[1, 3, 6, 12].map((every): TimeStep => ({ unit: 'hour', every })),
  ...[1, 2].map((every): TimeStep => ({ unit: 'day', every })),
  ...[1, 2].map((every): TimeStep => ({ unit: 'week', every })),
  ...[1, 2, 3, 6].map((every): TimeStep => ({ unit: 'month', every })),
  ...[1, 2, 5, 10, 20, 50, 100].map((every): TimeStep => ({ unit: 'year', every })),
];

const MONDAY_EPOCH_DAY = 4;

/** The ticks of one step inside the domain, on calendar boundaries in UTC. */
function stepTicks(low: number, high: number, step: TimeStep): number[] {
  const out: number[] = [];
  if (step.unit === 'hour' || step.unit === 'day' || step.unit === 'week') {
    const size = step.unit === 'hour' ? HOUR : step.unit === 'day' ? DAY : 7 * DAY;
    const unit = size * step.every;
    const origin = step.unit === 'week' ? MONDAY_EPOCH_DAY * DAY : 0;
    for (let t = origin + Math.ceil((low - origin) / unit) * unit; t <= high; t += unit)
      out.push(t);
    return out;
  }
  const start = new Date(low);
  const perUnit = step.unit === 'year' ? 12 : 1;
  const every = step.every * perUnit;
  let index = start.getUTCFullYear() * 12 + start.getUTCMonth();
  index = Math.ceil(index / every) * every;
  for (; ; index += every) {
    const t = Date.UTC(Math.floor(index / 12), index % 12, 1);
    if (t > high) break;
    if (t >= low) out.push(t);
  }
  return out;
}

const FORMATS: Record<TimeStep['unit'], Intl.DateTimeFormatOptions> = {
  hour: { hour: '2-digit', minute: '2-digit' },
  day: { day: 'numeric', month: 'short' },
  week: { day: 'numeric', month: 'short' },
  month: { month: 'short', year: 'numeric' },
  year: { year: 'numeric' },
};

/**
 * At most `max` ticks over a span of milliseconds, on the hour, day, Monday,
 * month or year boundaries of UTC, whichever step is the first to fit. The
 * labels are written in `locale`. Page dates are date-only strings, which
 * parse as UTC midnight, so UTC is the zone a tick falls on.
 */
export function timeTicks(domain: [number, number], max: number, locale: string): Tick[] {
  const [low, high] = domain;
  let chosen: { step: TimeStep; ticks: number[] } | null = null;
  for (const step of TIME_STEPS) {
    const ticks = stepTicks(low, high, step);
    if (ticks.length <= max) {
      chosen = { step, ticks };
      break;
    }
  }
  if (!chosen) {
    // A span of centuries: widen the year step until it fits.
    for (let every = 100; chosen === null; every *= 2) {
      const step: TimeStep = { unit: 'year', every };
      const ticks = stepTicks(low, high, step);
      if (ticks.length <= max) chosen = { step, ticks };
    }
  }
  const format = new Intl.DateTimeFormat(locale, { ...FORMATS[chosen.step.unit], timeZone: 'UTC' });
  return chosen.ticks.map((value) => ({ value, label: format.format(value) }));
}

const DURATION_STEPS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600, 43_200, 86_400,
];

/** At most `max` ticks over a span of seconds, on a step of whole seconds, minutes or hours. */
export function durationTicks(domain: [number, number], max: number): number[] {
  const [low, high] = domain;
  let ticks: number[] = [];
  for (const step of DURATION_STEPS) {
    ticks = [];
    for (let t = Math.ceil(low / step) * step; t <= high; t += step) ticks.push(t);
    if (ticks.length <= max) return ticks;
  }
  return ticks;
}

/** At most about `intervals` round values inside `domain`. */
function numericTicks(domain: [number, number], intervals: number): number[] {
  const scale = niceScale(domain, intervals);
  const eps = (domain[1] - domain[0]) * 1e-9;
  return scale.ticks.filter((tick) => tick >= domain[0] - eps && tick <= domain[1] + eps);
}

/**
 * The x axis' labelled ticks over `domain`, placed inside the drawing. Fewer
 * and fewer ticks are tried until every label fits beside its neighbours, so
 * the same call serves a phone and a wide card.
 */
export function xAxisTicks(input: {
  kind: 'number' | 'time' | 'duration';
  domain: [number, number];
  box: Box;
  /** Writes a number or duration tick; a time axis writes its own labels. */
  format?: (value: number) => string;
  measure: Measure;
  locale?: string;
  /** The drawing's width, the limit a label may not pass; the box's right edge plus its margin if unset. */
  width?: number;
}): PlacedTick[] {
  const { domain, box, measure } = input;
  const x = linearX(domain, box.left, box.right);
  const width = input.width ?? box.right + 12;
  const write = input.format ?? String;
  const candidates = (tries: number): Tick[] =>
    input.kind === 'time'
      ? timeTicks(domain, tries, input.locale ?? 'en-GB')
      : (input.kind === 'duration'
          ? durationTicks(domain, tries)
          : numericTicks(domain, tries)
        ).map((value) => ({ value, label: write(value) }));
  const lay = (ticks: Tick[]): PlacedTick[] => {
    const centres = ticks.map((tick) => x.position(tick.value));
    const widths = ticks.map((tick) => Math.ceil(measure(tick.label)));
    // A label never starts left of the plot, so the first one sits to the right of its tick
    // and clears the value labels that hang beside the axis' origin.
    return placeLabels(centres, widths, box.left, width, LABEL_GAP).map((p) => ({
      ...(ticks[p.index] as Tick),
      x: centres[p.index] as number,
      left: p.left,
      width: p.width,
    }));
  };
  let last: PlacedTick[] = [];
  for (const tries of [10, 8, 6, 5, 4, 3, 2]) {
    const ticks = candidates(tries);
    last = lay(ticks);
    if (last.length === ticks.length) return last;
  }
  return last;
}

// --- A stack of lanes ------------------------------------------------------

export type Lane = { box: Box };
export type Stack = { height: number; lanes: Lane[] };

/**
 * Lanes one under another, every one with the same left and right so a sample
 * has the same x in each. Each lane keeps its own top margin for its title;
 * the bottom margin, for the axis labels and title, sits once under the last.
 */
export function stackLayout(input: {
  width: number;
  lanes: number;
  laneHeight: number;
  margins: Margins;
}): Stack {
  const { margins } = input;
  const left = margins.left;
  const right = Math.max(left + 1, input.width - margins.right);
  const lanes: Lane[] = [];
  let top = 0;
  for (let i = 0; i < input.lanes; i++) {
    const plotTop = top + margins.top;
    lanes.push({ box: { left, right, top: plotTop, bottom: plotTop + input.laneHeight } });
    top = plotTop + input.laneHeight + LANE_PAD;
  }
  const bottom = lanes[lanes.length - 1]?.box.bottom ?? 0;
  return { height: bottom + margins.bottom, lanes };
}

// --- Brushing --------------------------------------------------------------

/** A drag narrower than this many pixels is a click, not a brush. */
const MIN_BRUSH_PX = 6;

/**
 * The x domain a drag from `startPx` to `endPx` covers, in either direction and
 * clamped to the plot; null when the drag is too short to be a brush.
 */
export function brushDomain(
  startPx: number,
  endPx: number,
  x: XScale,
  minPx = MIN_BRUSH_PX
): [number, number] | null {
  const a = Math.max(x.left, Math.min(startPx, endPx));
  const b = Math.min(x.right, Math.max(startPx, endPx));
  if (b - a < minPx) return null;
  return [x.value(a), x.value(b)];
}

/** The first index whose value is at least `target`, or past `target` when `past` is set; `xs.length` when none is. */
function bound(xs: readonly number[], target: number, past: boolean): number {
  let low = 0;
  let high = xs.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const value = xs[mid] ?? Infinity;
    if (past ? value <= target : value < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

export type IndexRange = { from: number; to: number };

/** The samples of `xs`, which do not decrease, from `low` to `high` inclusive; null when none lies there. */
export function indexRange(xs: readonly number[], low: number, high: number): IndexRange | null {
  const from = bound(xs, low, false);
  const to = bound(xs, high, true) - 1;
  return from <= to ? { from, to } : null;
}

/**
 * The sample indexes a zoomed lane draws: those from `low` to `high`, thinned
 * evenly to at most `limit` with both ends kept.
 */
export function visibleIndexes(
  xs: readonly number[],
  low: number,
  high: number,
  limit: number
): number[] {
  const range = indexRange(xs, low, high);
  if (!range) return [];
  const count = range.to - range.from + 1;
  if (count <= limit) return Array.from({ length: count }, (_, i) => range.from + i);
  const picked = new Set<number>();
  for (let i = 0; i < limit; i++) {
    picked.add(range.from + Math.round((i * (count - 1)) / (limit - 1)));
  }
  return [...picked];
}

// --- The other kinds -------------------------------------------------------

export type Bin = { low: number; high: number; count: number };

/** `count` bins of equal width over the finite values' extent; a value on an inner edge goes up. */
export function histogramBins(values: readonly number[], count: number): Bin[] {
  const extent = finiteExtent(values);
  if (!extent || count < 1) return [];
  const low = extent.min;
  const high = extent.max === extent.min ? extent.min + 1 : extent.max;
  const width = (high - low) / count;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    low: low + i * width,
    high: low + (i + 1) * width,
    count: 0,
  }));
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const bin = bins[Math.min(count - 1, Math.floor((value - low) / width))];
    if (bin) bin.count++;
  }
  return bins;
}

export type Trend = { slope: number; intercept: number; spread: number };

/**
 * The least-squares line through the points and the standard deviation of the
 * points about it, which a scatter draws as a band either side. Null with
 * fewer than two points or one x.
 */
export function trendBand(xs: readonly number[], ys: readonly number[]): Trend | null {
  const pairs: [number, number][] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (y !== undefined && Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  });
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  const sxx = pairs.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = pairs.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / sxx;
  const intercept = my - slope * mx;
  const residual = pairs.reduce((s, [x, y]) => s + (y - (intercept + slope * x)) ** 2, 0);
  return { slope, intercept, spread: n > 2 ? Math.sqrt(residual / (n - 2)) : 0 };
}

/** Round durations in seconds, the ticks of a power curve's axis. */
export const DURATION_TICKS = [
  1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 18_000, 36_000,
];
/** Round distances in metres, the ticks of a pace curve's axis. */
export const DISTANCE_TICKS = [100, 400, 1000, 5000, 10_000, 21_097.5, 42_195, 100_000];

/** The round values of `candidates` inside the domain. */
export function logTicks(
  domain: [number, number],
  candidates: readonly number[] = DURATION_TICKS
): number[] {
  return candidates.filter((value) => value >= domain[0] && value <= domain[1]);
}

/** A log axis' position: the fraction of the way from `low` to `high`. */
export function logFraction(value: number, low: number, high: number): number {
  if (low <= 0 || high <= low) return 0;
  return (Math.log(Math.max(value, low)) - Math.log(low)) / (Math.log(high) - Math.log(low));
}

export type CalendarCell = { date: string; row: number; column: number };

/** The day number of a `YYYY-MM-DD` date, days since the epoch in UTC. */
const dayNumber = (date: string) => Math.floor(Date.parse(date) / DAY);

/**
 * Days placed in week columns, Monday on the top row. The first column holds
 * the earliest date's week, and the columns count up from it.
 */
export function calendarLayout(dates: readonly string[]): CalendarCell[] {
  const numbers = dates.map(dayNumber).filter(Number.isFinite);
  if (numbers.length === 0) return [];
  const rowOf = (day: number) => (((day + 3) % 7) + 7) % 7;
  const first = Math.min(...numbers);
  const origin = first - rowOf(first);
  return dates.flatMap((date) => {
    const day = dayNumber(date);
    if (!Number.isFinite(day)) return [];
    return [{ date, row: rowOf(day), column: Math.floor((day - origin) / 7) }];
  });
}

/** The gap between calendar cells. */
export const CALENDAR_GAP = 2;
/** Room left of the calendar weeks for the weekday labels. */
export const CALENDAR_WEEKDAY_ROOM = 28;
const CALENDAR_MIN_CELL = 6;
const CALENDAR_MAX_CELL = 14;

/**
 * The cell size every calendar year draws with: the one the longest row fits
 * in `width`, so a short year is no larger than a full one.
 */
export function calendarCellSize(width: number, columnCounts: readonly number[]): number {
  const longest = Math.max(1, ...columnCounts);
  const fit = Math.floor((width - CALENDAR_WEEKDAY_ROOM) / longest) - CALENDAR_GAP;
  return Math.max(CALENDAR_MIN_CELL, Math.min(CALENDAR_MAX_CELL, fit));
}

/** The gap between the crosshair and a tooltip beside it. */
const TOOLTIP_GAP = 10;

/**
 * The left edge of a tooltip `width` wide beside a crosshair at `x`: right of
 * it while that fits inside `min` to `max`, left of it otherwise, and never
 * outside the range.
 */
export function tooltipLeft(x: number, width: number, min: number, max: number): number {
  const right = x + TOOLTIP_GAP;
  const wanted = right + width <= max ? right : x - TOOLTIP_GAP - width;
  return Math.max(min, Math.min(wanted, max - width));
}
