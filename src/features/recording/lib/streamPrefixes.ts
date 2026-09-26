/**
 * The parts of a recording summary that can be answered for any window
 * without walking it.
 *
 * A trim handle moves once a frame, and the review screen recomputed
 * elevation gain and the heart-rate and power averages over the whole window
 * each time. Built once per recording, these answer the same questions in
 * constant time, so a drag costs the same on a five-hour ride as on a lap of
 * the block.
 *
 * Every prefix is exclusive: `p[i]` covers the points before `i`, so a window
 * of `[start, end]` inclusive is `p[end + 1] - p[start]`.
 */

export interface StreamPrefixes {
  /** Positive altitude deltas, `gain[i]` covering the steps into points < i. */
  gain: number[];
  /** The gain each point contributed, for the one step a window disowns. */
  step: number[];
  /** First point at or after `i` with a usable altitude, or `length`. */
  nextValid: number[];
  hrSum: number[];
  hrCount: number[];
  powerSum: number[];
  powerCount: number[];
  length: number;
}

const usable = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Build the prefixes for one recording. O(n), once. */
export function buildStreamPrefixes(streams: {
  altitude: readonly number[];
  heartrate: readonly number[];
  power: readonly number[];
}): StreamPrefixes {
  const length = streams.altitude.length;

  const gain = new Array<number>(length + 1).fill(0);
  const step = new Array<number>(length).fill(0);
  let previous: number | null = null;
  for (let i = 0; i < length; i += 1) {
    const alt = streams.altitude[i];
    if (usable(alt)) {
      if (previous !== null && alt > previous) step[i] = alt - previous;
      previous = alt;
    }
    gain[i + 1] = gain[i] + step[i];
  }

  const nextValid = new Array<number>(length + 1).fill(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    nextValid[i] = usable(streams.altitude[i]) ? i : nextValid[i + 1];
  }

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
    gain,
    step,
    nextValid,
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

/**
 * Elevation gain over `[start, end]`, matching `elevationGain` over the same
 * slice.
 *
 * The prefix counts the step into every point against the last usable
 * altitude before it, which for the window's own first usable point lies
 * outside the window. That one step is taken back here, which is the whole
 * difference between this and a subtraction.
 */
export function windowGain(prefixes: StreamPrefixes, start: number, end: number): number {
  const window = bounded(prefixes, start, end);
  if (!window) return 0;
  const [first, last] = window;
  const total = prefixes.gain[last + 1] - prefixes.gain[first + 1];
  const firstUsable = prefixes.nextValid[first];
  const disowned = firstUsable > first && firstUsable <= last ? prefixes.step[firstUsable] : 0;
  return total - disowned;
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
