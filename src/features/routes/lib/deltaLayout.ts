/**
 * Pixel layout for the delta plot. The engine decides every lap's seconds won
 * or lost against the reference along the section, which lap each reference
 * is and the peak the y axis scales to; this only places them: one path per
 * lap, the zero line, a curve moved onto another reference, where a distance
 * falls on the x axis and the grid point a touch snaps to.
 */

import { chartBoundsFor, xForValue, yForValue } from '@/shared/charts';
import type { FfiDirectionDeltas, FfiLapDelta, FfiSplitSummary } from 'veloqrs';

/** What the section map needs to colour its line by the shown attempt's per-stretch delta. */
export interface SectionDeltaLine {
  /** Seconds won (negative) or lost per `splitStepM` metres, in the attempt's travel order. */
  splits: ArrayLike<number>;
  splitStepM: number;
  sectionLengthM: number;
  direction: 'forward' | 'reverse';
}

export interface DeltaFrame {
  width: number;
  height: number;
  padding: { left: number; right: number; top: number; bottom: number };
}

export interface DeltaLapPath {
  activityId: string;
  startIndex: number;
  /**
   * SVG path data, at most two points a pixel column besides where each run
   * starts. A NaN run in the lap's curve starts a new subpath.
   */
  path: string;
  emphasised: boolean;
}

export interface DeltaLayout {
  laps: DeltaLapPath[];
  /** The pixel row of the reference, zero seconds. */
  zeroY: number;
  /** Seconds from the zero line to the top and bottom edge of the plot. */
  extentSecs: number;
  xForDistance: (distanceM: number) => number;
}

/** The scrub readout moves in steps of this many metres. */
export const SCRUB_SNAP_M = 100;

/** Smallest half-range of the y axis, so a level lap does not collapse it. */
const MIN_EXTENT_SECS = 1;

/** The selected lap when it is among `laps`, else the newest. */
export function pickEmphasisedLap(
  laps: readonly FfiLapDelta[],
  selectedActivityId: string | undefined
): FfiLapDelta | undefined {
  const selected =
    selectedActivityId === undefined
      ? undefined
      : laps.find((lap) => lap.activityId === selectedActivityId);
  if (selected) return selected;
  return laps.reduce<FfiLapDelta | undefined>(
    (newest, lap) =>
      newest === undefined || lap.activityDate >= newest.activityDate ? lap : newest,
    undefined
  );
}

/**
 * The seconds the scrub reads at grid index `index`, from the lap's curve at
 * full resolution rather than from the path drawn, which keeps only a pixel
 * column's extremes.
 */
export function scrubDeltaSecs(lap: FfiLapDelta | undefined, index: number): number | undefined {
  if (lap === undefined || !Number.isInteger(index) || index < 0) return undefined;
  return index < lap.deltaSecs.length ? lap.deltaSecs[index] : undefined;
}

/**
 * A curve measured against another reference on the same grid: the engine
 * measures every curve against one stored reference, so a lap against any
 * other is the difference of the two. NaN wherever either curve has no point.
 */
export function rebaseCurve(curve: ArrayLike<number>, reference: ArrayLike<number>): Float32Array {
  const rebased = new Float32Array(curve.length);
  for (let i = 0; i < curve.length; i += 1) {
    rebased[i] = i < reference.length ? Number(curve[i]) - Number(reference[i]) : NaN;
  }
  return rebased;
}

/**
 * SVG path data for one curve. A long curve holds many grid points to a pixel
 * column, so a column draws only its lowest and highest point, in the order
 * they come, which keeps a one-point surge on the plot. A run's first point is
 * drawn as well, so a lap starts exactly where its coverage does.
 */
function curvePath(
  curve: Float32Array,
  columnOf: (index: number) => number,
  pointAt: (index: number, secs: number) => string
): string {
  let path = '';
  let drawing = false;
  let lastDrawn = -1;
  let column = -1;
  // The column's lowest and highest point so far, as [index, seconds].
  let low: [number, number] | null = null;
  let high: [number, number] | null = null;
  const draw = ([index, secs]: [number, number]) => {
    if (index === lastDrawn) return;
    const point = pointAt(index, secs);
    path += drawing ? ` L${point}` : `${path === '' ? '' : ' '}M${point}`;
    drawing = true;
    lastDrawn = index;
  };
  const flush = () => {
    if (low === null || high === null) return;
    const [first, second] = low[0] <= high[0] ? [low, high] : [high, low];
    draw(first);
    draw(second);
    low = null;
    high = null;
  };
  curve.forEach((secs, i) => {
    if (!Number.isFinite(secs)) {
      flush();
      drawing = false;
      return;
    }
    if (!drawing) draw([i, secs]);
    const at = columnOf(i);
    if (at !== column) {
      flush();
      column = at;
    }
    if (low === null || secs < low[1]) low = [i, secs];
    if (high === null || secs > high[1]) high = [i, secs];
  });
  flush();
  return path;
}

export function layoutDelta(
  deltas: FfiDirectionDeltas,
  gridStepM: number,
  sectionLengthM: number,
  frame: DeltaFrame,
  selectedActivityId: string | undefined
): DeltaLayout {
  const { padding } = frame;
  const plotWidth = Math.max(0, frame.width - padding.left - padding.right);
  const plotHeight = Math.max(0, frame.height - padding.top - padding.bottom);

  const extentSecs = Math.max(deltas.peakDeltaSecs, MIN_EXTENT_SECS);
  const zeroY = padding.top + plotHeight / 2;

  const xForDistance = (distanceM: number) =>
    padding.left + (sectionLengthM > 0 ? (distanceM / sectionLengthM) * plotWidth : 0);
  // Behind the reference is positive and drawn up, so ahead falls below zero.
  const yForSecs = (secs: number) => zeroY - (secs / extentSecs) * (plotHeight / 2);
  const columns = Math.max(1, Math.ceil(plotWidth));
  const columnOf = (index: number) =>
    sectionLengthM > 0
      ? Math.min(Math.floor(((index * gridStepM) / sectionLengthM) * plotWidth), columns - 1)
      : 0;

  const emphasised = pickEmphasisedLap(deltas.laps, selectedActivityId);
  const laps = deltas.laps.map((lap) => ({
    activityId: lap.activityId,
    startIndex: lap.startIndex,
    path: curvePath(
      lap.deltaSecs,
      columnOf,
      (i, secs) => `${xForDistance(i * gridStepM)} ${yForSecs(secs)}`
    ),
    emphasised: lap === emphasised,
  }));

  return { laps, zeroY, extentSecs, xForDistance };
}

/**
 * The stops the scrub readout snaps to: every 100 m from the start that lies
 * on the section, each with the grid index of the curve point there.
 */
export function scrubStops(
  sectionLengthM: number,
  gridStepM: number
): { distanceM: number; index: number }[] {
  if (!(sectionLengthM >= 0)) return [];
  const count = Math.floor(sectionLengthM / SCRUB_SNAP_M) + 1;
  return Array.from({ length: count }, (_, stop) => {
    const distanceM = stop * SCRUB_SNAP_M;
    return { distanceM, index: gridStepM > 0 ? Math.round(distanceM / gridStepM) : 0 };
  });
}

/** One split's bar in the typical-attempt plot, in pixels. */
export interface SplitSummaryBar {
  index: number;
  left: number;
  right: number;
  /** The bar runs from the zero line to the median, so one of these is the zero line. */
  top: number;
  bottom: number;
  /** Behind the reference over the split, drawn above the zero line. */
  lost: boolean;
  /** The quartiles, where both are finite. */
  whisker: { top: number; bottom: number } | null;
}

export interface SplitSummaryLayout {
  bars: SplitSummaryBar[];
  zeroY: number;
  /** Seconds from the zero line to the top and bottom edge of the plot. */
  extentSecs: number;
  /** The pixel x at the middle of each split, one per median, the last split short. */
  splitCentres: number[];
}

/** The share of its split a bar spans, centred in it. */
const BAR_SHARE = 0.5;

/**
 * Bars for the engine's typical attempt per split: the median from the zero
 * line, lost above and won below as the lap curves are, with the quartiles as
 * a whisker. A split whose median is NaN has no bar, and one with either
 * quartile NaN has no whisker. The y axis scales to the largest finite figure.
 */
export function layoutSplitSummary(
  summary: FfiSplitSummary,
  splitStepM: number,
  sectionLengthM: number,
  frame: DeltaFrame
): SplitSummaryLayout {
  const bounds = chartBoundsFor(frame.width, frame.height, frame.padding);
  const { medianSecs, lowerQuartileSecs, upperQuartileSecs } = summary;

  let peak = 0;
  for (const series of [medianSecs, lowerQuartileSecs, upperQuartileSecs]) {
    for (const secs of series) if (Number.isFinite(secs)) peak = Math.max(peak, Math.abs(secs));
  }
  const extentSecs = Math.max(peak, MIN_EXTENT_SECS);
  const yFor = (secs: number) => yForValue(secs, [-extentSecs, extentSecs], bounds);
  const xFor = (distanceM: number) => xForValue(distanceM, [0, sectionLengthM], bounds);
  const zeroY = yFor(0);

  const bars: SplitSummaryBar[] = [];
  if (splitStepM > 0 && sectionLengthM > 0) {
    medianSecs.forEach((secs, index) => {
      if (!Number.isFinite(secs)) return;
      const start = xFor(Math.min(index * splitStepM, sectionLengthM));
      const end = xFor(Math.min((index + 1) * splitStepM, sectionLengthM));
      const inset = ((end - start) * (1 - BAR_SHARE)) / 2;
      const y = yFor(secs);
      const lower = lowerQuartileSecs[index];
      const upper = upperQuartileSecs[index];
      bars.push({
        index,
        left: start + inset,
        right: end - inset,
        top: Math.min(y, zeroY),
        bottom: Math.max(y, zeroY),
        lost: secs > 0,
        whisker:
          lower !== undefined &&
          upper !== undefined &&
          Number.isFinite(lower) &&
          Number.isFinite(upper)
            ? { top: yFor(Math.max(lower, upper)), bottom: yFor(Math.min(lower, upper)) }
            : null,
      });
    });
  }

  const splitCentres =
    splitStepM > 0 && sectionLengthM > 0
      ? Array.from(medianSecs, (_, index) => {
          const start = Math.min(index * splitStepM, sectionLengthM);
          const end = Math.min((index + 1) * splitStepM, sectionLengthM);
          return xFor((start + end) / 2);
        })
      : [];

  return { bars, zeroY, extentSecs, splitCentres };
}
