/**
 * Local instants where calendar arithmetic tends to break: the last evening of
 * a month and of a year, the first minutes of the next, a leap day, a Sunday
 * night, and the days the clocks change in the three regions most athletes
 * are in. Built with the local `Date` constructor, so each is an edge in
 * whatever zone the suite runs under.
 *
 *   describe.each(CLOCK_EDGES)('on %s', (_name, at) => {
 *     beforeEach(() => jest.setSystemTime(at));
 *   });
 */
export const CLOCK_EDGES: [string, Date][] = [
  ['a month end', new Date(2026, 0, 31, 12, 0)],
  ['late on a month end', new Date(2026, 3, 30, 23, 30)],
  ['late on 31 December', new Date(2026, 11, 31, 23, 30)],
  ['just after midnight on 1 January', new Date(2027, 0, 1, 0, 30)],
  ['a leap day', new Date(2028, 1, 29, 12, 0)],
  ['a Sunday night', new Date(2026, 5, 21, 23, 30)],
  ['the day the US clocks go forward', new Date(2026, 2, 8, 12, 0)],
  ['the day the European clocks go forward', new Date(2026, 2, 29, 12, 0)],
  ['the day the Australian clocks go back', new Date(2026, 3, 5, 12, 0)],
  ['the day the European clocks go back', new Date(2026, 9, 25, 12, 0)],
];

/**
 * The local calendar day `offsetDays` from `at`, as `YYYY-MM-DD`. The day is
 * counted in UTC from the local date's parts, so a DST change cannot shift it
 * and the answer does not share code with the local-date helpers under test.
 */
export function localDay(at: Date, offsetDays = 0): string {
  const day = new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate() + offsetDays));
  return day.toISOString().slice(0, 10);
}
