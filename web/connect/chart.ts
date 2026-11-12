// The activity page's chart arithmetic: series on one shared x axis that is
// distance or time, a line per series that breaks at a gap, and the crosshair's
// reading at a sample. Pure, so a test drives it without a browser.
//
// Every series shares one index space with the time and distance samples, so
// sample `i` of one is sample `i` of all of them, and a gap is NaN.

export type Axis = 'distance' | 'time';

export type ChartData = {
  /** Seconds from the start, one per sample, not decreasing. */
  time: readonly number[];
  /** Metres from the start, one per sample, not decreasing. */
  distance: readonly number[];
  /** The other series by name, one value per sample. */
  series: Readonly<Record<string, readonly number[]>>;
};

export type Range = { low: number; high: number };

/** The first and last value of the axis, or null with no samples. */
export function axisRange(data: ChartData, axis: Axis): Range | null {
  const values = data[axis];
  if (values.length === 0) return null;
  return { low: values[0] ?? 0, high: values[values.length - 1] ?? 0 };
}

/**
 * A series' lowest and highest finite value, or null when it has none. A
 * series that never changes is widened by one either side, so its line sits
 * mid-plot rather than on an edge.
 */
export function seriesRange(data: ChartData, key: string): Range | null {
  let low = Infinity;
  let high = -Infinity;
  for (const value of data.series[key] ?? []) {
    if (!Number.isFinite(value)) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (low > high) return null;
  return low === high ? { low: low - 1, high: high + 1 } : { low, high };
}

/** Where sample `index` sits on the axis, in pixels from the plot's left edge. */
export function xOf(data: ChartData, axis: Axis, index: number, width: number): number {
  const range = axisRange(data, axis);
  const span = range ? range.high - range.low : 0;
  if (!range || span <= 0) return 0;
  return (((data[axis][index] ?? range.low) - range.low) / span) * width;
}

/**
 * The sample nearest a pointer `x` pixels from the plot's left edge, clamped to
 * the ride. Null when the ride has no samples. The axis value under the pointer
 * is found first, so the same pointer names a different sample on the distance
 * axis than on the time axis, and each sample's own position names it back.
 */
export function indexAtX(data: ChartData, axis: Axis, x: number, width: number): number | null {
  const values = data[axis];
  const range = axisRange(data, axis);
  if (!range) return null;
  const span = range.high - range.low;
  const fraction = width > 0 ? Math.min(1, Math.max(0, x / width)) : 0;
  const target = range.low + fraction * span;
  let low = 0;
  let high = values.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((values[mid] ?? Infinity) < target) low = mid + 1;
    else high = mid;
  }
  const before = low - 1;
  const near = values[low] ?? target;
  if (before >= 0 && target - (values[before] ?? target) < near - target) return before;
  return low;
}

const point = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/**
 * An SVG path for one series in a `width` by `height` plot: its own range fills
 * the height, and the line starts afresh after every gap so nothing is drawn
 * through one. A sample alone between gaps is a zero-length segment, which a
 * round cap draws as a dot. Empty when the series has no finite sample.
 */
export function linePath(
  data: ChartData,
  axis: Axis,
  key: string,
  width: number,
  height: number
): string {
  const values = data.series[key];
  const range = seriesRange(data, key);
  if (!values || !range) return '';
  const span = range.high - range.low;
  const parts: string[] = [];
  let drawing = false;
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? NaN;
    if (!Number.isFinite(value)) {
      drawing = false;
      continue;
    }
    const at = point(xOf(data, axis, i, width), height - ((value - range.low) / span) * height);
    const next = values[i + 1];
    const alone = !drawing && !(next !== undefined && Number.isFinite(next));
    parts.push(`${drawing ? 'L' : 'M'}${at}`);
    if (alone) parts.push(`L${at}`);
    drawing = true;
  }
  return parts.join('');
}

export type Reading = {
  index: number;
  time: number;
  distance: number;
  /** The visible series with a value at the sample, in the order asked. */
  values: { key: string; value: number }[];
};

/** What the crosshair reports at sample `index`; null outside the ride. */
export function crosshair(
  data: ChartData,
  visible: readonly string[],
  index: number
): Reading | null {
  if (!Number.isInteger(index) || index < 0 || index >= data.time.length) return null;
  const values: Reading['values'] = [];
  for (const key of visible) {
    const value = data.series[key]?.[index];
    if (value !== undefined && Number.isFinite(value)) values.push({ key, value });
  }
  return { index, time: data.time[index] ?? NaN, distance: data.distance[index] ?? NaN, values };
}
