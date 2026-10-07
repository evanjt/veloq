/**
 * Colours a section line by the seconds an attempt won or lost against the
 * reference in each stretch of the section, for MapLibre `line-gradient`.
 *
 * The scale is diverging and symmetric: time won, time lost and level with the
 * reference sit at -1, +1 and 0 of the attempt's largest absolute stretch. A
 * stretch the attempt did not cover (NaN) takes the no-data grey.
 *
 * Requires the `ShapeSource` to set `lineMetrics: true` so that
 * `line-progress` expressions are available.
 */
import { mapLayerColors } from '@/theme';

function mix(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const channel = (shift: number) => {
    const low = (a >> shift) & 0xff;
    const high = (b >> shift) & 0xff;
    return Math.round(low + (high - low) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** The colour at `scaled` of the scale, -1 (won) to +1 (lost); beyond that it clamps. */
export function deltaToColor(scaled: number): string {
  const t = Math.max(-1, Math.min(1, scaled));
  return t < 0
    ? mix(mapLayerColors.deltaNeutral, mapLayerColors.deltaWon, -t)
    : mix(mapLayerColors.deltaNeutral, mapLayerColors.deltaLost, t);
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
  splits: readonly number[],
  splitStepM: number,
  sectionLengthM: number,
  direction: 'forward' | 'reverse'
): (string | number)[] | null {
  if (splits.length === 0 || !(splitStepM > 0) || !(sectionLengthM > 0)) return null;

  let peak = 0;
  for (const secs of splits) if (Number.isFinite(secs)) peak = Math.max(peak, Math.abs(secs));

  const bins = splits.map((secs, i) => {
    const start = Math.min(i * splitStepM, sectionLengthM);
    const end = Math.min((i + 1) * splitStepM, sectionLengthM);
    const color = !Number.isFinite(secs)
      ? mapLayerColors.deltaNoData
      : peak === 0
        ? mapLayerColors.deltaNeutral
        : deltaToColor(secs / peak);
    return direction === 'reverse' ? { start: sectionLengthM - end, color } : { start, color };
  });
  if (direction === 'reverse') bins.reverse();

  const pairs: (string | number)[] = [];
  let lastProgress = -1;
  let lastColor: string = mapLayerColors.deltaNoData;
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
