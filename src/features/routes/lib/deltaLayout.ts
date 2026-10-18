/**
 * Pixel layout for the delta plot. The engine decides every lap's seconds won
 * or lost against the reference along the section, which lap each reference
 * is and the peak the y axis scales to; this only places them: one path per
 * lap, the zero line, the area between the emphasised lap and it, a curve
 * moved onto another reference, where a distance falls on the x axis and the
 * grid point a touch snaps to. Ahead of the reference is drawn up, though the
 * engine's sign for ahead is negative, so the plot reads the way a faster time
 * feels and the engine and the map line keep one sign.
 */

import { chartBoundsFor, xForValue, yForValue, type XY } from '@/shared/charts';
import { FfiReferenceSource } from 'veloqrs';
import type { FfiDirectionDeltas, FfiLapDelta, FfiSplitSummary } from 'veloqrs';

/** What the section map needs to band its line by how far ahead or behind the shown attempt is. */
export interface SectionDeltaLine {
  /**
   * Percent slower (positive) or faster than the reference per `splitStepM`
   * metres, in the attempt's travel order. NaN over a stretch with no data.
   */
  percents: ArrayLike<number>;
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

/**
 * The area between the emphasised lap and the zero line, as SVG path data: one
 * closed subpath for each stretch the lap spends on one side, split where it
 * crosses zero and where its curve has a gap. Empty for a side it never reaches.
 */
export interface DeltaFill {
  ahead: string;
  behind: string;
}

export interface DeltaLayout {
  laps: DeltaLapPath[];
  fill: DeltaFill;
  /** The pixel row of the reference, zero seconds. */
  zeroY: number;
  /** Seconds from the zero line to the top and bottom edge of the plot. */
  extentSecs: number;
  xForDistance: (distanceM: number) => number;
  yForSecs: (secs: number) => number;
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

/** The engine's split deltas measured against another reference's, as `rebaseCurve` does the curve. */
function rebaseOptional(
  values: ArrayLike<number> | undefined,
  reference: ArrayLike<number> | undefined
): Float32Array {
  if (values === undefined) return new Float32Array(0);
  return reference === undefined
    ? Float32Array.from(values, () => NaN)
    : rebaseCurve(values, reference);
}

/**
 * The reference's own seconds over each split, read from whichever of `laps`
 * covers it: a lap's time there less its delta against the reference. Every
 * lap is measured against the one reference, so any covering lap gives the
 * same time, and a reference chosen on the chart (`deltasAgainst`) gives its
 * own. NaN over a split no lap covers.
 */
export function referenceSplitSecs(laps: readonly FfiLapDelta[]): Float32Array {
  const length = laps.reduce((most, lap) => Math.max(most, lap.splitDeltaSecs.length), 0);
  const secs = new Float32Array(length).fill(NaN);
  for (const lap of laps) {
    const own = lap.splitSecs as ArrayLike<number> | undefined;
    if (own === undefined) continue;
    for (let i = 0; i < length; i += 1) {
      if (Number.isFinite(secs[i])) continue;
      const reference = Number(own[i]) - Number(lap.splitDeltaSecs[i]);
      if (Number.isFinite(reference)) secs[i] = reference;
    }
  }
  return secs;
}

/**
 * Seconds behind the reference over each split as a percent of the
 * reference's time there, negative ahead. NaN where either is missing or the
 * reference took no time.
 */
export function splitPercents(
  deltaSecs: ArrayLike<number>,
  referenceSecs: ArrayLike<number>
): Float32Array {
  return Float32Array.from(deltaSecs, (delta, i) => {
    const reference = Number(referenceSecs[i]);
    return reference > 0 ? (Number(delta) / reference) * 100 : NaN;
  });
}

/**
 * The references the delta plot can be measured against: the one the engine
 * measured every curve against, then the previous record and the typical lap
 * where the engine gave their curves. A record the athlete's own reference
 * replaced has no curve here, so it is not offered.
 */
export function referenceChoices(deltas: FfiDirectionDeltas): FfiReferenceSource[] {
  const choices = [deltas.referenceSource];
  if (deltas.previousRecord) choices.push(FfiReferenceSource.PreviousRecord);
  if (deltas.typicalDeltaSecs) choices.push(FfiReferenceSource.Typical);
  return choices;
}

/** The reference shown: the one asked for when offered, else the engine's default, else the stored one. */
export function resolveReference(
  deltas: FfiDirectionDeltas,
  requested: FfiReferenceSource | undefined
): FfiReferenceSource {
  const choices = referenceChoices(deltas);
  if (requested !== undefined && choices.includes(requested)) return requested;
  return choices.includes(deltas.defaultReference)
    ? deltas.defaultReference
    : deltas.referenceSource;
}

/**
 * The direction's curves measured against `source`, each the difference of
 * two stored arrays (`rebaseCurve`), with the peak taken again over them. The
 * engine's own deltas when `source` is the stored reference or has no curve.
 */
export function deltasAgainst(
  deltas: FfiDirectionDeltas,
  source: FfiReferenceSource
): FfiDirectionDeltas {
  if (source === deltas.referenceSource) return deltas;
  const previous = deltas.previousRecord;
  const reference =
    source === FfiReferenceSource.PreviousRecord && previous
      ? {
          activityId: previous.activityId,
          curve: previous.deltaSecs,
          splits: previous.splitDeltaSecs as ArrayLike<number> | undefined,
        }
      : source === FfiReferenceSource.Typical && deltas.typicalDeltaSecs
        ? {
            activityId: '',
            curve: deltas.typicalDeltaSecs,
            splits: deltas.splitSummary?.medianSecs,
          }
        : undefined;
  if (reference === undefined) return deltas;

  const referenceEnd = reference.curve[reference.curve.length - 1];
  let peakDeltaSecs = 0;
  const laps = deltas.laps.map((lap) => {
    const deltaSecs = rebaseCurve(lap.deltaSecs, reference.curve);
    for (const secs of deltaSecs) {
      if (Number.isFinite(secs)) peakDeltaSecs = Math.max(peakDeltaSecs, Math.abs(secs));
    }
    const end =
      lap.endDeltaSecs !== undefined && referenceEnd !== undefined
        ? lap.endDeltaSecs - referenceEnd
        : NaN;
    const rebased: FfiLapDelta = {
      ...lap,
      deltaSecs,
      splitDeltaSecs: rebaseOptional(lap.splitDeltaSecs, reference.splits),
    };
    if (Number.isFinite(end)) rebased.endDeltaSecs = end;
    else delete rebased.endDeltaSecs;
    return rebased;
  });
  return {
    ...deltas,
    referenceActivityId: reference.activityId,
    referenceSource: source,
    laps,
    peakDeltaSecs,
  };
}

/**
 * The points drawn for one curve, one list per run. A long curve holds many grid points to a pixel
 * column, so a column draws only its lowest and highest point, in the order
 * they come, which keeps a one-point surge on the plot. A run's first point is
 * drawn as well, so a lap starts exactly where its coverage does.
 */
function curveRuns(
  curve: Float32Array,
  columnOf: (index: number) => number,
  pointAt: (index: number, secs: number) => XY
): XY[][] {
  const runs: XY[][] = [];
  let run: XY[] | null = null;
  let lastDrawn = -1;
  let column = -1;
  // The column's lowest and highest point so far, as [index, seconds].
  let low: [number, number] | null = null;
  let high: [number, number] | null = null;
  const draw = ([index, secs]: [number, number]) => {
    if (index === lastDrawn) return;
    if (run === null) {
      run = [];
      runs.push(run);
    }
    run.push(pointAt(index, secs));
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
      run = null;
      return;
    }
    if (run === null) draw([i, secs]);
    const at = columnOf(i);
    if (at !== column) {
      flush();
      column = at;
    }
    if (low === null || secs < low[1]) low = [i, secs];
    if (high === null || secs > high[1]) high = [i, secs];
  });
  flush();
  return runs;
}

/** SVG path data for a curve's runs, each a subpath. */
function runsPath(runs: readonly XY[][]): string {
  return runs
    .map((run) => run.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '))
    .join(' ');
}

/**
 * The closed areas between a curve's runs and the zero line, one per stretch
 * on one side. A crossing between two drawn points is placed on the zero line
 * by linear interpolation, so the two areas meet there.
 */
function fillBetween(runs: readonly XY[][], zeroY: number): DeltaFill {
  const fill = { ahead: [] as string[], behind: [] as string[] };
  // Ahead is drawn up, so it lies above the zero row in pixels.
  const sideOf = (y: number) => (y < zeroY ? 'ahead' : y > zeroY ? 'behind' : null);
  for (const run of runs) {
    const points: XY[] = [];
    run.forEach((p, i) => {
      const prev = run[i - 1];
      if (
        prev &&
        sideOf(prev.y) !== null &&
        sideOf(p.y) !== null &&
        sideOf(prev.y) !== sideOf(p.y)
      ) {
        const t = (zeroY - prev.y) / (p.y - prev.y);
        points.push({ x: prev.x + t * (p.x - prev.x), y: zeroY });
      }
      points.push(p);
    });
    let side: 'ahead' | 'behind' | null = null;
    let stretch: XY[] = [];
    let lastZero: XY | null = null;
    const close = () => {
      const first = stretch[0];
      const last = stretch[stretch.length - 1];
      if (side !== null && first && last) {
        const edge = stretch.map((p) => `L${p.x} ${p.y}`).join(' ');
        fill[side].push(`M${first.x} ${zeroY} ${edge} L${last.x} ${zeroY} Z`);
      }
      side = null;
      stretch = [];
    };
    for (const p of points) {
      const at = sideOf(p.y);
      if (at === null) {
        if (side !== null) stretch.push(p);
        close();
        lastZero = p;
        continue;
      }
      if (at !== side) {
        close();
        side = at;
        stretch = lastZero ? [lastZero] : [];
      }
      stretch.push(p);
      lastZero = null;
    }
    close();
  }
  return { ahead: fill.ahead.join(' '), behind: fill.behind.join(' ') };
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
  // Ahead of the reference is negative and drawn up, so behind falls below zero.
  const yForSecs = (secs: number) => zeroY + (secs / extentSecs) * (plotHeight / 2);
  const columns = Math.max(1, Math.ceil(plotWidth));
  const columnOf = (index: number) =>
    sectionLengthM > 0
      ? Math.min(Math.floor(((index * gridStepM) / sectionLengthM) * plotWidth), columns - 1)
      : 0;

  const emphasised = pickEmphasisedLap(deltas.laps, selectedActivityId);
  let fill: DeltaFill = { ahead: '', behind: '' };
  const laps = deltas.laps.map((lap) => {
    const runs = curveRuns(lap.deltaSecs, columnOf, (i, secs) => ({
      x: xForDistance(i * gridStepM),
      y: yForSecs(secs),
    }));
    if (lap === emphasised) fill = fillBetween(runs, zeroY);
    return {
      activityId: lap.activityId,
      startIndex: lap.startIndex,
      path: runsPath(runs),
      emphasised: lap === emphasised,
    };
  });

  return { laps, fill, zeroY, extentSecs, xForDistance, yForSecs };
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
  /** Behind the reference over the split, drawn below the zero line. */
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
 * line, won above and lost below as the lap curves are, with the quartiles as
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
  // Ahead is negative and drawn up, as on the lap curves.
  const yFor = (secs: number) => yForValue(-secs, [-extentSecs, extentSecs], bounds);
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
            ? { top: yFor(Math.min(lower, upper)), bottom: yFor(Math.max(lower, upper)) }
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
