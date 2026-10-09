import { elevationOver } from './elevationChange';

/**
 * The parts of a recording summary a trim window asks for on every frame.
 *
 * A trim handle moves once a frame, and the review screen recomputed the
 * heart-rate and power averages over the whole window each time. Built once
 * per recording, these answer them in constant time, so a drag costs the same
 * on a five-hour ride as on a lap of the block.
 *
 * Every prefix is exclusive: `p[i]` covers the points before `i`, so a window
 * of `[start, end]` inclusive is `p[end + 1] - p[start]`.
 *
 * Elevation gain has no prefix: a rise counts against the level the window
 * last counted, which depends on where the window opens, so it is replayed
 * over the window in one pass that allocates nothing.
 */

export interface StreamPrefixes {
  altitude: readonly number[];
  hrSum: number[];
  hrCount: number[];
  powerSum: number[];
  powerCount: number[];
  length: number;
}

/** Build the prefixes for one recording. O(n), once. */
export function buildStreamPrefixes(streams: {
  altitude: readonly number[];
  heartrate: readonly number[];
  power: readonly number[];
}): StreamPrefixes {
  const length = streams.altitude.length;

  const prefixOf = (values: readonly number[]) => {
    const sum = new Array<number>(values.length + 1).fill(0);
    const count = new Array<number>(values.length + 1).fill(0);
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i];
      const counts = v > 0;
      sum[i + 1] = sum[i] + (counts ? v : 0);
      count[i + 1] = count[i] + (counts ? 1 : 0);
    }
    return { sum, count };
  };

  const hr = prefixOf(streams.heartrate);
  const power = prefixOf(streams.power);

  return {
    altitude: streams.altitude,
    hrSum: hr.sum,
    hrCount: hr.count,
    powerSum: power.sum,
    powerCount: power.count,
    length,
  };
}

/** Clamp a window to the points that exist, and order its ends. */
function bounded(prefixes: StreamPrefixes, start: number, end: number): [number, number] | null {
  const first = Math.max(0, Math.min(start, prefixes.length - 1));
  const last = Math.max(0, Math.min(end, prefixes.length - 1));
  if (prefixes.length === 0 || last < first) return null;
  return [first, last];
}

/** Elevation gain over `[start, end]`, the engine's rule over that slice alone. */
export function windowGain(prefixes: StreamPrefixes, start: number, end: number): number {
  const window = bounded(prefixes, start, end);
  if (!window) return 0;
  return elevationOver(prefixes.altitude, window[0], window[1]).gain;
}

/** Mean of the positive values in `[start, end]`, or null when there are none. */
export function windowAverage(
  sum: readonly number[],
  count: readonly number[],
  prefixes: StreamPrefixes,
  start: number,
  end: number
): number | null {
  const window = bounded(prefixes, start, end);
  if (!window) return null;
  const [first, last] = window;
  const n = count[last + 1] - count[first];
  if (n === 0) return null;
  return (sum[last + 1] - sum[first]) / n;
}
