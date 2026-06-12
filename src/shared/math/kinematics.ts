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
 * Total elevation gain (m): sum of positive deltas between consecutive valid
 * altitude samples. Null/undefined/non-finite samples are skipped without
 * resetting the previous reference, so a dropout doesn't fabricate a gain.
 * With treatZeroAsMissing, 0 is also skipped — the FIT encoding uses 0 for
 * no-data, so a missing sample shouldn't read as sea level.
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
