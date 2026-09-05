import type { WellnessData } from '@/types';

function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() - days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The row a trend arrow compares against: the newest one on or before
 * `latestDate - lookbackDays` that carries `field`. Rows are stored per logged
 * day, not per day, so a row is only a baseline while it is no further back
 * than the lookback again. Past that the gap is wider than the comparison it
 * would stand for, and the caller renders no arrow.
 *
 * `wellness` must be sorted by `id` descending.
 */
export function baselineOnOrBefore(
  wellness: WellnessData[],
  latestDate: string,
  lookbackDays: number,
  field: (row: WellnessData) => number | null | undefined = () => 0
): WellnessData | undefined {
  const newest = shiftDays(latestDate, lookbackDays);
  const oldest = shiftDays(latestDate, lookbackDays * 2);
  return wellness.find((row) => {
    if (row.id > newest || row.id < oldest) return false;
    const value = field(row);
    return value !== null && value !== undefined;
  });
}
