/**
 * Scenario: the fitness charts label their points with a `YYYY-MM-DD` day
 * string, and the strength list labels a set with a wall-clock stamp the
 * engine stores as UTC.
 *
 * Expected behaviour: both render the day they name, wherever the athlete is.
 * `new Date('2026-03-14')` parses as UTC midnight, so west of Greenwich it is
 * the 13th by the time it reaches the formatter.
 *
 * **The assertions do not move the timezone, on purpose.** Jest freezes the
 * process zone: `process.env.TZ` set inside a test changes neither `Date` nor
 * `Intl`, so a test that sets it and reads a rendered string is asserting
 * against the box's own zone whatever it claims. The first draft of this file
 * did exactly that and passed against the unfixed code. What is asserted
 * instead is the property itself, that the instant a day string resolves to is
 * the same instant `new Date(y, m - 1, d)` gives, which is true in every zone
 * and false in every zone but UTC before the fix.
 */

import {
  formatShortDate,
  formatShortDateWithWeekday,
  formatMonth,
  formatFullDate,
  formatFullDateWithWeekday,
  formatEpochDayUtc,
  parseDayString,
} from '@/shared/format/format';

jest.mock('@/i18n', () => ({
  getCurrentLanguage: () => 'en-AU',
  i18n: { t: (key: string) => key },
}));

/** The Date a formatter hands to Intl, whatever it renders. */
function dateHandedToIntl(format: (d: string) => string, day: string): Date {
  let seen = new Date(NaN);
  const spy = jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
    this: Date
  ) {
    seen = this;
    return '';
  });
  try {
    format(day);
  } finally {
    spy.mockRestore();
  }
  return seen;
}

const localMidnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe('a day string resolves to its own local day', () => {
  it.each([
    ['formatShortDate', formatShortDate],
    ['formatShortDateWithWeekday', formatShortDateWithWeekday],
    ['formatMonth', formatMonth],
    ['formatFullDate', formatFullDate],
    ['formatFullDateWithWeekday', formatFullDateWithWeekday],
  ])('%s', (_name, format) => {
    expect(dateHandedToIntl(format, '2026-03-14').getTime()).toBe(localMidnight(2026, 3, 14));
  });

  /** The first of a month is where an off-by-one day changes the month too. */
  it('does not fall back a month on the first', () => {
    expect(dateHandedToIntl(formatMonth, '2026-03-01').getTime()).toBe(localMidnight(2026, 3, 1));
  });

  /** And the first of January changes the year. */
  it('does not fall back a year on New Year', () => {
    expect(dateHandedToIntl(formatFullDate, '2026-01-01').getTime()).toBe(
      localMidnight(2026, 1, 1)
    );
  });

  /** A full timestamp is an instant, not a day, and keeps its old meaning. */
  it('still treats a timestamp as an instant', () => {
    expect(dateHandedToIntl(formatShortDate, '2026-03-14T12:00:00Z').toISOString()).toBe(
      '2026-03-14T12:00:00.000Z'
    );
  });

  it('takes a Date through untouched', () => {
    const d = new Date(2026, 2, 14, 9, 30);
    expect(dateHandedToIntl(formatShortDate as never, d as never).getTime()).toBe(d.getTime());
  });
});

describe('parseDayString', () => {
  it('is local midnight for a plain day', () => {
    expect(parseDayString('2026-03-14').getTime()).toBe(localMidnight(2026, 3, 14));
  });

  it('leaves anything that is not a plain day to Date itself', () => {
    expect(parseDayString('2026-03-14T12:00:00Z').toISOString()).toBe('2026-03-14T12:00:00.000Z');
  });

  it('gives an invalid date back for nonsense rather than guessing', () => {
    expect(Number.isNaN(parseDayString('not a date').getTime())).toBe(true);
  });

  /** A month or day out of range is not a day, so it is not reinterpreted. */
  it('does not build a rolled-over date from an impossible day', () => {
    expect(Number.isNaN(parseDayString('2026-02-31').getTime())).toBe(true);
  });
});

describe('a stored wall-clock stamp', () => {
  /**
   * `activity_metrics.date` is seconds, and the engine stores the athlete's
   * wall-clock day as though it were UTC. Reading it in local time is the same
   * off-by-one in the other direction, so the render is pinned to UTC.
   */
  it('renders its own day at the start of the UTC day', () => {
    expect(formatEpochDayUtc(Date.UTC(2026, 2, 14) / 1000)).toBe('14 Mar');
  });

  it('renders its own day at the far end of the UTC day', () => {
    expect(formatEpochDayUtc(Date.UTC(2026, 2, 14, 23, 59) / 1000)).toBe('14 Mar');
  });
});
