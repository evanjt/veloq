/**
 * Scenario: the fitness and insights dashboards lay out the engine's numbers.
 *
 * Expected behaviour: a dot resolves to its day's activities, the months sort
 * by any column with absent values last, the calendar runs a year per row
 * with weeks aligned on the first day of the week, and the range and sport
 * live in the address.
 */

import {
  FITNESS_SPORTS,
  calendarYears,
  dotsOnDay,
  fitnessChoices,
  fitnessQuery,
  sortMonths,
  type MonthRow,
} from '../../../web/connect/dashboard';
import { parse, write } from '../../../web/connect/router';

const dot = (activityId: string, startDateLocal: string) => ({ activityId, startDateLocal });

describe('dotsOnDay', () => {
  it('returns every activity that began on the day, in start order', () => {
    const dots = [
      dot('a', '2026-03-02T07:00:00'),
      dot('c', '2026-03-03T18:30:00'),
      dot('b', '2026-03-03T06:15:00'),
    ];
    expect(dotsOnDay(dots, '2026-03-03')).toEqual(['b', 'c']);
  });

  it('returns nothing for a day with no activity', () => {
    expect(dotsOnDay([dot('a', '2026-03-02T07:00:00')], '2026-03-04')).toEqual([]);
  });
});

describe('sortMonths', () => {
  const rows: MonthRow[] = [
    { key: '2026-01', count: 4, load: 120, distance: null },
    { key: '2026-02', count: 9, load: null, distance: 300 },
    { key: '2026-03', count: 2, load: 400, distance: 80 },
  ];

  it('sorts ascending with absent values last', () => {
    expect(sortMonths(rows, 'load', 'asc').map((r) => r.key)).toEqual([
      '2026-01',
      '2026-03',
      '2026-02',
    ]);
  });

  it('keeps absent values last when descending', () => {
    expect(sortMonths(rows, 'distance', 'desc').map((r) => r.key)).toEqual([
      '2026-02',
      '2026-03',
      '2026-01',
    ]);
  });

  it('does not reorder the input', () => {
    sortMonths(rows, 'count', 'desc');
    expect(rows[0].key).toBe('2026-01');
  });

  it('keeps the original order between equal values', () => {
    const tied: MonthRow[] = [
      { key: 'x', count: 1, load: 5, distance: null },
      { key: 'y', count: 1, load: 5, distance: null },
    ];
    expect(sortMonths(tied, 'load', 'desc').map((r) => r.key)).toEqual(['x', 'y']);
  });
});

describe('calendarYears', () => {
  const day = (date: string, activityCount = 1) => ({ date, intensity: 1, activityCount });

  it('groups days into one row per year, the newest year first', () => {
    const years = calendarYears([day('2025-12-31'), day('2026-01-01')], 1);
    expect(years.map((y) => y.year)).toEqual([2026, 2025]);
  });

  it('aligns weeks on a Monday by default: 2026-01-01 is a Thursday, column 3', () => {
    const [row] = calendarYears([day('2026-01-01')], 1);
    const cell = row.weeks[0].find((c) => c?.date === '2026-01-01');
    expect(row.weeks[0].indexOf(cell!)).toBe(3);
    expect(row.weeks[0]).toHaveLength(7);
  });

  it('aligns weeks on a Sunday when that is the first day: the same day is column 4', () => {
    const [row] = calendarYears([day('2026-01-01')], 0);
    expect(row.weeks[0].findIndex((c) => c?.date === '2026-01-01')).toBe(4);
  });

  it('starts a new week after the last day of the week', () => {
    const [row] = calendarYears([day('2026-01-04'), day('2026-01-05')], 1);
    expect(row.weeks).toHaveLength(2);
    expect(row.weeks[1][0]?.date).toBe('2026-01-05');
  });

  it('pads days the read does not hold with empty cells', () => {
    const [row] = calendarYears([day('2026-01-05')], 1);
    expect(row.weeks[0].slice(1).every((c) => c === null)).toBe(true);
  });

  it('is empty for no days', () => {
    expect(calendarYears([], 1)).toEqual([]);
  });
});

describe('the fitness address', () => {
  it('reads range and sport from the query and falls back to the defaults', () => {
    const route = parse('#/fitness?range=180&sport=Run');
    expect(fitnessChoices(route)).toEqual({ range: 180, sport: 'Run', open: null });
    expect(fitnessChoices(parse('#/fitness?range=7&sport=Kayak'))).toEqual({
      range: 90,
      sport: FITNESS_SPORTS[0],
      open: null,
    });
  });

  it('writes a choice into the hash and drops the defaults it does not need', () => {
    const route = fitnessQuery(parse('#/fitness'), { range: 365, sport: 'Run', open: 'i9' });
    expect(write(route)).toBe('#/fitness?range=365&sport=Run&open=i9');
    expect(write(fitnessQuery(route, { range: 90, sport: 'Ride', open: null }))).toBe('#/fitness');
  });
});
