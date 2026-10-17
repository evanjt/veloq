/**
 * Peak-preserving thinning of a stream for drawing.
 *
 * The x range is split into `buckets` equal spans, one per pixel of plot
 * width, and each span keeps its first, lowest, highest and last finite
 * sample. A short spike is the highest or lowest sample of the span it falls
 * in, so it survives at any width, where keeping every Nth sample drops it.
 *
 * A span holding a missing sample (any non-finite value) also keeps its first
 * missing sample, so a line drawn through the result still breaks there. A
 * sample with a non-finite x stays in the span of the sample before it.
 *
 * Returns raw indices in ascending order, at most five for each pass through a
 * span (one pass each when x never falls back) and never more than the input.
 * A stream no longer than the bucket count comes back whole.
 */
export function minMaxBuckets(
  x: ArrayLike<number>,
  values: ArrayLike<number>,
  buckets: number
): number[] {
  const n = Math.min(x.length, values.length);
  const spans = Math.max(1, Math.floor(buckets));
  if (n <= spans) return Array.from({ length: n }, (_, i) => i);

  let xMin = Infinity;
  let xMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = x[i] ?? NaN;
    if (!Number.isFinite(v)) continue;
    if (v < xMin) xMin = v;
    if (v > xMax) xMax = v;
  }
  const xRange = xMax - xMin;
  const scale = Number.isFinite(xRange) && xRange > 0 ? spans / xRange : 0;

  const kept: number[] = [];
  let span = -1;
  let first = -1;
  let last = -1;
  let low = -1;
  let high = -1;
  let gap = -1;
  let lowValue = Infinity;
  let highValue = -Infinity;

  const flush = () => {
    const picks = [first, low, high, last, gap].filter((i) => i >= 0).sort((a, b) => a - b);
    for (const i of picks) {
      if (kept[kept.length - 1] !== i) kept.push(i);
    }
    first = last = low = high = gap = -1;
    lowValue = Infinity;
    highValue = -Infinity;
  };

  for (let i = 0; i < n; i++) {
    const xv = x[i] ?? NaN;
    const next = Number.isFinite(xv)
      ? Math.min(spans - 1, Math.floor((xv - xMin) * scale))
      : Math.max(span, 0);
    if (next !== span) {
      if (span >= 0) flush();
      span = next;
    }

    const v = values[i] ?? NaN;
    if (!Number.isFinite(v)) {
      if (gap < 0) gap = i;
      continue;
    }
    if (first < 0) first = i;
    last = i;
    if (v < lowValue) {
      low = i;
      lowValue = v;
    }
    if (v > highValue) {
      high = i;
      highValue = v;
    }
  }
  flush();

  return kept;
}
