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
