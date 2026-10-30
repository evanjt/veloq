/**
 * The history slider reaches the athlete's first-ever activity, so a single
 * drag can start an arbitrarily large download. Past this many activities the
 * panel asks first.
 */
export const LARGE_HISTORY_THRESHOLD = 500;

/**
 * An upper bound on how many activities a widening from `to` back to `from`
 * would download, from the per-year counts the sync stores.
 *
 * Year buckets are the granularity available, so both boundary years count
 * whole. That over-counts rather than under-counts, which is the safe
 * direction for a warning, and the copy says "up to" for the same reason.
 * An empty list means the count is unknown, which reads as zero: the gate must
 * not block a user behind a figure it does not have.
 */
export function activitiesInRange(
  countsByYear: readonly { year: number; count: number }[] | undefined,
  from: Date,
  to: Date
): number {
  if (!countsByYear) return 0;
  let total = 0;
  for (const { year, count } of countsByYear) {
    if (year >= from.getFullYear() && year <= to.getFullYear()) total += count;
  }
  return total;
}

/**
 * What the large-download confirm says. A range holding more activities than
 * one day's backfill share cannot finish in a day, so the confirm names the
 * days it takes at least; a range inside the share, or an engine that reports
 * no share, gets the size wording alone.
 *
 * The share is the engine's (`backfillDayShare`). This is the same whole-day
 * rounding `governor::days_to_draw` applies to the queue, taken here only
 * because the range's count is not in the queue yet.
 */
export type HistoryConfirmCopy =
  { kind: 'days'; count: number; days: number } | { kind: 'size'; count: number };

export function historyConfirmCopy(
  count: number,
  dayShare: number | undefined
): HistoryConfirmCopy {
  if (!dayShare || count <= dayShare) return { kind: 'size', count };
  return { kind: 'days', count, days: Math.ceil(count / dayShare) };
}
