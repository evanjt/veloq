/**
 * Which day a critical-speed snapshot belongs to.
 *
 * The row is keyed on `(date, sport_type)`, so the date decides whether a
 * re-read replaces the point it already wrote or adds a new one. Stamping it
 * with the clock makes every launch a new point: a curve fetched weeks ago
 * then draws a flat run through the pace trend that no training produced. The
 * curve's own end date is the day the reading is about, and re-reading the
 * same stored curve on any later day writes the same row.
 */

/** Local midnight, in seconds, of the day `endDate` names. */
export function paceSnapshotDate(endDate: string | undefined, now: Date = new Date()): number {
  const day = endDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!day) return Math.floor(new Date(now).setHours(0, 0, 0, 0) / 1000);
  const midnight = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  return Math.floor(midnight.getTime() / 1000);
}
