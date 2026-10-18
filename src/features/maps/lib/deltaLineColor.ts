/**
 * Bands a section line by how far ahead or behind the shown attempt is over
 * each stretch, for MapLibre `line-gradient`.
 *
 * Each stretch is a percentage of the reference's own time over it and takes
 * the step `divergingStep` gives it, on the scale grade shares, so the same
 * percentage is the same colour on every attempt. A stretch the attempt did not
 * cover has no step: the ramp is clear there and a dashed layer over the cut-out
 * stretch (`noDataRanges`, `cutLineByProgress`) draws it instead.
 *
 * Requires the GeoJSON source spec to set `lineMetrics: true` so that
 * `line-progress` expressions are available.
 */
import { colorWithOpacity, type MapDivStep, type MapPalette } from '@/theme';
import { divergingStep } from './divergingStep';
import type { MapLayerSpec } from './htmlBuilders';

/** A run of the line, as fractions of its length, in one step or with no data. */
export interface LineBand {
  start: number;
  end: number;
  step: MapDivStep | null;
}

/**
 * The bands along the line, start to end. `percents` are an attempt's percent
 * slower (positive) or faster than the reference per `splitStepM` metres, in
 * the attempt's travel order, the last stretch short. The line is drawn in the
 * forward direction, so a reverse attempt's stretches are mirrored onto it.
 * Neighbouring stretches in one step are one band. Returns `null` without
 * stretches or a length to place them on.
 */
export function deltaLineBands(
  percents: ArrayLike<number>,
  splitStepM: number,
  sectionLengthM: number,
  direction: 'forward' | 'reverse'
): LineBand[] | null {
  if (percents.length === 0 || !(splitStepM > 0) || !(sectionLengthM > 0)) return null;

  const stretches = Array.from(percents, (percent, i) => {
    const start = Math.min(i * splitStepM, sectionLengthM) / sectionLengthM;
    const end = Math.min((i + 1) * splitStepM, sectionLengthM) / sectionLengthM;
    const step = divergingStep(percent, 'pace');
    return direction === 'reverse'
      ? { start: 1 - end, end: 1 - start, step }
      : { start, end, step };
  });
  if (direction === 'reverse') stretches.reverse();

  const bands: LineBand[] = [];
  for (const stretch of stretches) {
    if (!(stretch.end > stretch.start)) continue;
    const last = bands[bands.length - 1];
    if (last && last.step === stretch.step) last.end = stretch.end;
    else bands.push({ ...stretch });
  }
  const first = bands[0];
  const last = bands[bands.length - 1];
  if (!first || !last) return null;
  first.start = 0;
  last.end = 1;
  return bands;
}

/** The runs of the line with no data, as `[start, end]` fractions of its length. */
export function noDataRanges(bands: readonly LineBand[] | null): [number, number][] {
  return (bands ?? []).filter((band) => band.step === null).map((band) => [band.start, band.end]);
}

/**
 * The `line-gradient` for `bands`: a `step` over `line-progress` in the
 * base's ramp, so each band keeps its colour up to the next. A band with no
 * data is clear, for the dashed layer over it.
 */
export function lineBandExpression(bands: readonly LineBand[], palette: MapPalette): unknown[] {
  const colour = (step: MapDivStep | null) =>
    step === null ? colorWithOpacity(palette.muted, 0) : palette.div[step];
  const expression: unknown[] = ['step', ['line-progress'], colour(bands[0]?.step ?? null)];
  for (const band of bands.slice(1)) expression.push(band.start, colour(band.step));
  return expression;
}

/** The source holding the stretches of the line with no data, cut by `cutLineByProgress`. */
export const DELTA_GAPS_SOURCE_ID = 'delta-gaps';

/**
 * The stretches with no data, dashed two on two in the base's muted colour over
 * the clear part of the ramp, at the width of the line they sit on. Its source
 * is declared in every mode, empty when nothing is banded.
 */
export function buildDeltaGapLayer(palette: MapPalette, lineWidth: number): MapLayerSpec {
  return {
    id: 'delta-gap-line',
    type: 'line',
    source: DELTA_GAPS_SOURCE_ID,
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': palette.muted, 'line-width': lineWidth, 'line-dasharray': [2, 2] },
  };
}
