import { localWallClockToEpochSeconds } from './startDate';

/**
 * The trailing weeks ending today, oldest first. Each is seven local days,
 * midnight to 23:59:59, and the last ends tonight, so the weeks meet with no
 * gap and no overlap. Bounds are in the wall-clock-as-UTC space the engine
 * stamps `activity_metrics.date` in.
 *
 * The strength tab draws these weeks and the strength insights compare them,
 * and a card opens that tab, so both ask here.
 */
export function trailingWeekRanges(weekCount: number): { startTs: number; endTs: number }[] {
  const end = new Date();
  end.setHours(23, 59, 59, 0);

  const ranges: { startTs: number; endTs: number }[] = [];
  for (let index = weekCount - 1; index >= 0; index -= 1) {
    const rangeEnd = new Date(end);
    rangeEnd.setDate(rangeEnd.getDate() - index * 7);

    const rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 6);
    rangeStart.setHours(0, 0, 0, 0);

    ranges.push({
      startTs: localWallClockToEpochSeconds(rangeStart),
      endTs: localWallClockToEpochSeconds(rangeEnd),
    });
  }

  return ranges;
}
