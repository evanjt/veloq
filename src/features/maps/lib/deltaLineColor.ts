/**
 * Colours a section line by the seconds an attempt won or lost against the
 * reference in each stretch of the section, for MapLibre `line-gradient`.
 *
 * The scale is diverging and symmetric: time won, time lost and level with the
 * reference sit at -1, +1 and 0 of the attempt's largest absolute stretch. A
 * stretch the attempt did not cover (NaN) takes the no-data grey.
 *
 * Requires the GeoJSON source spec to set `lineMetrics: true` so that
 * `line-progress` expressions are available.
 */
import { mixColour, type MapPalette } from '@/theme';

/** The colour at `scaled` of the scale, -1 (won) to +1 (lost); beyond that it clamps. */
export function deltaToColor(scaled: number, { layer }: MapPalette): string {
  const t = Math.max(-1, Math.min(1, scaled));
  return t < 0
    ? mixColour(layer.deltaNeutral, layer.deltaWon, -t)
    : mixColour(layer.deltaNeutral, layer.deltaLost, t);
}

/**
 * `[progress, color, ...]` pairs for an `['interpolate', ['linear'], ['line-progress'], ...]`
 * expression. `splits` are an attempt's seconds won (negative) or lost per
 * `splitStepM` metres, in the attempt's travel order, the last bin short. The
 * line is drawn in the forward direction, so a reverse attempt's bins are
 * mirrored onto it. Each stop sits where its bin begins on the line and the
 * last bin's colour runs out to progress 1. Returns `null` without bins or a
 * length to place them on.
 */
export function buildDeltaLineStops(
  splits: ArrayLike<number>,
  splitStepM: number,
  sectionLengthM: number,
  direction: 'forward' | 'reverse',
  palette: MapPalette
): (string | number)[] | null {
  const { layer } = palette;
  if (splits.length === 0 || !(splitStepM > 0) || !(sectionLengthM > 0)) return null;

  const values = Array.from(splits);
  let peak = 0;
  for (const secs of values) if (Number.isFinite(secs)) peak = Math.max(peak, Math.abs(secs));

  const bins = values.map((secs, i) => {
    const start = Math.min(i * splitStepM, sectionLengthM);
    const end = Math.min((i + 1) * splitStepM, sectionLengthM);
    const color = !Number.isFinite(secs)
      ? layer.deltaNoData
      : peak === 0
        ? layer.deltaNeutral
        : deltaToColor(secs / peak, palette);
    return direction === 'reverse' ? { start: sectionLengthM - end, color } : { start, color };
  });
  if (direction === 'reverse') bins.reverse();

  const pairs: (string | number)[] = [];
  let lastProgress = -1;
  let lastColor: string = layer.deltaNoData;
  for (const bin of bins) {
    lastColor = bin.color;
    const progress = bin.start / sectionLengthM;
    // Interpolate refuses stops that do not strictly increase.
    if (progress <= lastProgress) continue;
    pairs.push(progress, bin.color);
    lastProgress = progress;
  }
  if (lastProgress < 1) pairs.push(1, lastColor);
  return pairs;
}
