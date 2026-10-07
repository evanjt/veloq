/**
 * Pixel layout for the delta plot. The engine decides every lap's seconds won
 * or lost against the reference along the section; this only places them:
 * one path per lap, the zero line, where a distance falls on the x axis and
 * the grid point a touch snaps to.
 */

import type { FfiDirectionDeltas, FfiLapDelta } from 'veloqrs';

/** What the section map needs to colour its line by the shown attempt's per-stretch delta. */
export interface SectionDeltaLine {
  /** Seconds won (negative) or lost per `splitStepM` metres, in the attempt's travel order. */
  splits: readonly number[];
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
  /** SVG path data. A NaN run in the lap's curve starts a new subpath. */
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
  /** The distance in metres at a pixel x, clamped to the section. */
  distanceForX: (x: number) => number;
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

  let peak = 0;
  for (const lap of deltas.laps) {
    for (const secs of lap.deltaSecs) {
      if (Number.isFinite(secs)) peak = Math.max(peak, Math.abs(secs));
    }
  }
  const extentSecs = Math.max(peak, MIN_EXTENT_SECS);
  const zeroY = padding.top + plotHeight / 2;

  const xForDistance = (distanceM: number) =>
    padding.left + (sectionLengthM > 0 ? (distanceM / sectionLengthM) * plotWidth : 0);
  const distanceForX = (x: number) => {
    if (plotWidth <= 0) return 0;
    const fraction = (x - padding.left) / plotWidth;
    return Math.min(Math.max(fraction, 0), 1) * sectionLengthM;
  };
  // Behind the reference is positive and drawn up, so ahead falls below zero.
  const yForSecs = (secs: number) => zeroY - (secs / extentSecs) * (plotHeight / 2);

  const emphasised = pickEmphasisedLap(deltas.laps, selectedActivityId);
  const laps = deltas.laps.map((lap) => {
    let path = '';
    let drawing = false;
    lap.deltaSecs.forEach((secs, i) => {
      if (!Number.isFinite(secs)) {
        drawing = false;
        return;
      }
      const point = `${xForDistance(i * gridStepM)} ${yForSecs(secs)}`;
      path += drawing ? ` L${point}` : `${path === '' ? '' : ' '}M${point}`;
      drawing = true;
    });
    return {
      activityId: lap.activityId,
      startIndex: lap.startIndex,
      path,
      emphasised: lap === emphasised,
    };
  });

  return { laps, zeroY, extentSecs, xForDistance, distanceForX };
}

/** The 100 m stop nearest a touch and the grid index of the curve point there. */
export function snapScrubIndex(
  x: number,
  plot: Pick<DeltaLayout, 'distanceForX'>,
  gridStepM: number
): { distanceM: number; index: number } {
  const distanceM = Math.round(plot.distanceForX(x) / SCRUB_SNAP_M) * SCRUB_SNAP_M;
  return { distanceM, index: gridStepM > 0 ? Math.round(distanceM / gridStepM) : 0 };
}
