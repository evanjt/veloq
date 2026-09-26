/**
 * R6's reading: how far the latest value sits from its own baseline, in
 * standard deviations of the series behind it.
 *
 * The corridor in `rules.ts` is in those units, so a generator with two points
 * and no series has no delta to give rather than a ratio on another scale. An
 * absence is a claim the ranker can read; an invented number is not.
 */

/**
 * The z-score, or undefined when the series cannot carry one.
 *
 * `samples` needs two readings and some spread between them: a flat series puts
 * every reading on the baseline, where a distance in deviations means nothing.
 */
export function signalDeltaFrom(
  value: number,
  baseline: number,
  samples: readonly number[]
): number | undefined {
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) return undefined;
  if (samples.length < 2 || !samples.every((sample) => Number.isFinite(sample))) return undefined;

  const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const variance = samples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / samples.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return undefined;

  return Math.abs(value - baseline) / stddev;
}
