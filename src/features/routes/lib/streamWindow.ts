/**
 * The start date the engine needs to decide whether a sync downloads every
 * series or only the three the track needs (`B140`).
 *
 * It has to come from here rather than from the database: `activities.start_date`
 * is filled by the metrics sync, which lands after the GPS sync on a first run,
 * so the engine does not know the date at the moment it has to choose.
 */

/** Epoch seconds for an activity's local start, or undefined if unparseable. */
export function activityStartEpoch(startDateLocal: string | undefined | null): bigint | undefined {
  if (!startDateLocal) return undefined;
  const ms = Date.parse(startDateLocal);
  return Number.isFinite(ms) ? BigInt(Math.floor(ms / 1000)) : undefined;
}
