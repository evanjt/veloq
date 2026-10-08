/**
 * Fixed demo attempts at one section, for the tour's pictures of the section page. They are an
 * illustration, the same for every athlete: an athlete's own figures come from the engine on the
 * page itself.
 */

export interface DemoAttempt {
  /** Seconds the attempt took over the section. */
  timeSecs: number;
}

/** Fourteen attempts, oldest first, getting faster with the scatter real efforts have. */
export const TOUR_DEMO_ATTEMPTS: readonly DemoAttempt[] = [
  312, 305, 309, 298, 303, 294, 297, 289, 293, 286, 290, 281, 285, 279,
].map((timeSecs) => ({ timeSecs }));

/** Samples along the section in each demo delta curve. */
const DELTA_SAMPLES = 24;

/**
 * Pearson's correlation coefficient of two equal-length series, or null when either has no
 * spread or there are fewer than two pairs, where the coefficient is undefined.
 */
export function pearsonR(xs: readonly number[], ys: readonly number[]): number | null {
  const pairs = xs.slice(0, ys.length).map((x, i) => [x, ys[i] ?? 0] as const);
  const n = pairs.length;
  if (n < 2) return null;
  const meanX = pairs.reduce((s, [x]) => s + x, 0) / n;
  const meanY = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - meanX) * (y - meanY);
    sxx += (x - meanX) * (x - meanX);
    syy += (y - meanY) * (y - meanY);
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Least-squares line through the demo times against attempt order, as [first, last] times. */
export function demoTrendEnds(): [number, number] {
  const ys = TOUR_DEMO_ATTEMPTS.map((a) => a.timeSecs);
  const n = ys.length;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  ys.forEach((y, x) => {
    sxy += (x - meanX) * (y - meanY);
    sxx += (x - meanX) * (x - meanX);
  });
  const slope = sxy / sxx;
  return [meanY - slope * meanX, meanY + slope * (n - 1 - meanX)];
}

/** The trend coefficient the slide prints: demo times against attempt order. */
export function demoTrendR(): number | null {
  return pearsonR(
    TOUR_DEMO_ATTEMPTS.map((_, i) => i),
    TOUR_DEMO_ATTEMPTS.map((a) => a.timeSecs)
  );
}

/** Attempt counts in equal-width time bins, fastest bin first. */
export function demoHistogram(binCount: number): number[] {
  const times = TOUR_DEMO_ATTEMPTS.map((a) => a.timeSecs);
  const min = Math.min(...times);
  const width = (Math.max(...times) - min) / binCount || 1;
  const bins = new Array<number>(binCount).fill(0);
  for (const t of times) {
    const bin = Math.min(binCount - 1, Math.floor((t - min) / width));
    bins[bin] = (bins[bin] ?? 0) + 1;
  }
  return bins;
}

/**
 * Seconds ahead (negative) or behind (positive) the best attempt along the section, for the
 * newest few attempts, oldest first. The newest gains early, loses on the climb, and finishes
 * ahead.
 */
export function demoDeltaCurves(): number[][] {
  const finals = [9, 6, 4, 2, -3];
  return finals.map((final, lap) =>
    Array.from({ length: DELTA_SAMPLES }, (_, i) => {
      const along = i / (DELTA_SAMPLES - 1);
      const wobble = Math.sin(along * Math.PI * 2 + lap) * (1.5 + lap * 0.4);
      return final * along + wobble * Math.sin(along * Math.PI);
    })
  );
}

export type StretchKind = 'won' | 'lost' | 'level';

/** Below this many seconds gained or lost over a stretch, it reads level. */
const LEVEL_SECS = 0.15;

/** The newest attempt's gain or loss over each stretch of the section, as the map colours it. */
export function demoLineStretches(): { from: number; to: number; kind: StretchKind }[] {
  const newest = demoDeltaCurves().at(-1) ?? [];
  const last = newest.length - 1;
  return newest.slice(1).map((secs, i) => {
    const change = secs - (newest[i] ?? secs);
    const kind: StretchKind = change < -LEVEL_SECS ? 'won' : change > LEVEL_SECS ? 'lost' : 'level';
    return { from: i / last, to: (i + 1) / last, kind };
  });
}
