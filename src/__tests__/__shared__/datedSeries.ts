/** Readings as the engine's dated series: one per day, oldest first. */
export function datedSeries(values: number[], start = 1_700_000_000) {
  return values.map((value, index) => ({ value, date: start + index * 86_400 }));
}
