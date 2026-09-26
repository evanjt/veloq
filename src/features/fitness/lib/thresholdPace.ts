/**
 * Where the running threshold pace comes from.
 *
 * The downloaded pace curve is the sharper reading, but it lives behind a
 * network fetch: offline, or before the first fetch of a session, there is no
 * curve and the screen had nothing else to show. The app writes a critical
 * speed snapshot into `pace_history` every time it does fetch one, so the last
 * stored reading stands in rather than the figure vanishing.
 */

/** A critical speed is a speed: zero, negative and non-finite are all absent. */
function speed(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The curve's critical speed while it is loaded, else the persisted snapshot,
 * else null. Both are m/s, so the caller formats either the same way.
 */
export function resolveThresholdPace(
  curveSpeed: number | null | undefined,
  storedSpeed: number | null | undefined
): number | null {
  return speed(curveSpeed) ?? speed(storedSpeed);
}
