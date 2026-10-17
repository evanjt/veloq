import { yForValue, type Domain } from './cartesian';

/** One labelled value on a value axis. */
export interface AxisTick {
  value: number;
  label: string;
  testID?: string | undefined;
}

/** The vertical extent of the plot inside the box the labels share, in pixels from its top. */
export interface AxisBounds {
  top: number;
  bottom: number;
}

/**
 * The top of each label box, so the label's centre sits on its value's pixel.
 * The same projection the canvas draws with, so a label and its gridline meet.
 */
export function axisLabelTops(
  values: readonly number[],
  domain: Domain,
  bounds: AxisBounds,
  labelHeight: number
): number[] {
  const box = { left: 0, right: 0, top: bounds.top, bottom: bounds.bottom };
  return values.map((value) => yForValue(value, domain, box) - labelHeight / 2);
}

/** The step of 1, 2 or 5 times a power of ten at or above `raw`. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Decimal places that print a multiple of `step` exactly. */
function stepDecimals(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step)));
}

/**
 * A value axis over `extent`: the ends rounded out to a step of 1, 2 or 5 times
 * a power of ten, and a tick on every step. `intervals` is the step count aimed
 * for, the result may take one more where rounding out crosses a step.
 */
export function niceScale(
  extent: Domain,
  intervals: number
): { domain: Domain; ticks: number[]; step: number } {
  let lo = Math.min(extent[0], extent[1]);
  let hi = Math.max(extent[0], extent[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi === lo) {
    if (hi === 0) hi = 1;
    else if (lo > 0) lo = 0;
    else hi = 0;
  }
  const step = niceStep((hi - lo) / Math.max(1, intervals));
  const decimals = stepDecimals(step);
  const scale = 10 ** decimals;
  // Adding zero turns a rounded -0 into 0, so no tick prints as negative zero.
  const round = (n: number) => Math.round(n * scale) / scale + 0;
  const start = round(Math.floor(lo / step + 1e-9) * step);
  const end = round(Math.ceil(hi / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let i = 0; start + i * step <= end + step / 2; i++) ticks.push(round(start + i * step));
  return { domain: [start, end], ticks, step };
}
