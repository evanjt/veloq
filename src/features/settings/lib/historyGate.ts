/**
 * The history slider reaches the athlete's first-ever activity, so a single
 * drag can start an arbitrarily large download. Past this many activities the
 * panel asks first.
 */
export const LARGE_HISTORY_THRESHOLD = 500;

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
