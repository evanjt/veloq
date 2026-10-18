/** The ends of the effort scale an athlete rates a session on. */
export const RPE_MIN = 1;
export const RPE_MAX = 10;

const ZONE_BY_EFFORT = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6] as const;

/**
 * The training zone an effort rating is drawn in, so effort reads on the same
 * ladder as every other intensity: 1 and 2 in zone 1, 3 and 4 in zone 2, 5 in
 * zone 3, 6 and 7 in zone 4, 8 and 9 in zone 5, 10 in zone 6. A rating outside
 * the scale takes the nearer end.
 */
export function rpeZone(effort: number): number {
  const index = Math.min(Math.max(Math.round(effort), RPE_MIN), RPE_MAX) - RPE_MIN;
  return ZONE_BY_EFFORT[index] ?? 1;
}
