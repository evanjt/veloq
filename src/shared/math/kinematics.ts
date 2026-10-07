/**
 * Physical derivations from raw activity quantities. One source of truth so
 * speed is computed identically wherever moving time and distance meet.
 */

/**
 * Speed in metres per second from distance (m) and moving time (s).
 * Returns 0 for non-positive or non-finite inputs so a stopped or malformed
 * sample never yields NaN/Infinity.
 */
export function calculateSpeed(distanceMeters: number, movingTimeSeconds: number): number {
  if (!(movingTimeSeconds > 0)) return 0;
  const speed = distanceMeters / movingTimeSeconds;
  return Number.isFinite(speed) && speed > 0 ? speed : 0;
}

/**
 * Pace in minutes per reference distance from speed (m/s). Defaults to
 * min/km; pass 100 for swim min/100m. Returns 0 for non-positive or
 * non-finite speed so a stopped sample never yields NaN/Infinity.
 */
export function paceMinutesFromSpeed(speedMs: number, referenceMeters = 1000): number {
  if (!(speedMs > 0) || !Number.isFinite(speedMs)) return 0;
  const pace = referenceMeters / speedMs / 60;
  return Number.isFinite(pace) ? pace : 0;
}

/**
 * Speed in m/s from a pace in minutes per reference distance, the inverse of
 * `paceMinutesFromSpeed`. A zero or non-finite pace, which is how a stopped
 * sample reads, gives 0.
 */
export function speedFromPaceMinutes(paceMinutes: number, referenceMeters = 1000): number {
  if (!(paceMinutes > 0) || !Number.isFinite(paceMinutes)) return 0;
  return referenceMeters / (paceMinutes * 60);
}

/**
 * Pace for one stream sample. A missing sample (NaN, from a null in the stream)
 * stays NaN so the chart and scrub treat it as absent, where
 * `paceMinutesFromSpeed` would turn it into a 0:00 pace nobody ran. A stopped
 * sample still reads 0.
 */
export function paceMinutesFromSample(speedMs: number, referenceMeters = 1000): number {
  return Number.isNaN(speedMs) ? NaN : paceMinutesFromSpeed(speedMs, referenceMeters);
}

/**
 * Total elevation gain (m): sum of positive deltas between consecutive valid
 * altitude samples. Null/undefined/non-finite samples are skipped without
 * resetting the previous reference, so a dropout doesn't fabricate a gain.
 * The legacy treatZeroAsMissing option also skips zero for sources that use
 * it as a missing reading; otherwise sea level remains valid.
 */
export function elevationGain(
  altitudes: readonly (number | null | undefined)[],
  opts?: { treatZeroAsMissing?: boolean }
): number {
  const treatZeroAsMissing = opts?.treatZeroAsMissing ?? false;
  let gain = 0;
  let prev: number | null = null;
  for (const alt of altitudes) {
    if (alt == null || !Number.isFinite(alt)) continue;
    if (treatZeroAsMissing && alt === 0) continue;
    if (prev !== null && alt > prev) gain += alt - prev;
    prev = alt;
  }
  return gain;
}
