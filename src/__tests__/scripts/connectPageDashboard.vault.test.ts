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
  FITNESS_TABS,
  calendarYears,
  dotsOnDay,
  fitnessChoices,
  fitnessQuery,
  fitnessTabFor,
  decouplingRows,
  formZoneBands,
  monthTickLabels,
  sortMonths,
  wellnessLanes,
  type MonthRow,
  type WellnessDay,
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

describe('fitnessTabs', () => {
  it('names the four tabs in order and falls back to the first for an unknown one', () => {
    expect(FITNESS_TABS).toEqual(['overview', 'calendar', 'performance', 'trends']);
    expect(fitnessTabFor(parse('#/fitness?tab=trends'))).toBe('trends');
    expect(fitnessTabFor(parse('#/fitness?tab=nope'))).toBe('overview');
    expect(fitnessTabFor(parse('#/fitness'))).toBe('overview');
  });
});

describe('wellnessLanes', () => {
  const day = (date: string, extra: Partial<WellnessDay> = {}): WellnessDay => ({
    date,
    hrv: null,
    restingHr: null,
    weight: null,
    sleepSecs: null,
    ...extra,
  });

  it('gives every lane one value per day, with a gap where a day has none', () => {
    const lanes = wellnessLanes([
      day('2026-03-01', { hrv: 60, sleepSecs: 7200 }),
      day('2026-03-02', { restingHr: 48, weight: 70.5 }),
    ]);
    expect(lanes.map((lane) => lane.key)).toEqual(['hrv', 'restingHr', 'sleep', 'weight']);
    expect(lanes.every((lane) => lane.values.length === 2)).toBe(true);
    expect(lanes[0]?.values[0]).toBe(60);
    expect(lanes[0]?.values[1]).toBeNaN();
    expect(lanes[2]?.values[0]).toBe(2);
  });

  it('leaves out a lane no day has a value for', () => {
    const lanes = wellnessLanes([day('2026-03-01', { hrv: 55 }), day('2026-03-02')]);
    expect(lanes.map((lane) => lane.key)).toEqual(['hrv']);
  });

  it('returns nothing for no days', () => {
    expect(wellnessLanes([])).toEqual([]);
  });
});

describe('formZoneBands', () => {
  it('splits a range at the form boundaries, lowest first', () => {
    expect(formZoneBands(-40, 30).map((b) => [b.zone, b.from, b.to])).toEqual([
      ['highRisk', -40, -30],
      ['optimal', -30, -10],
      ['greyZone', -10, 5],
      ['fresh', 5, 25],
      ['transition', 25, 30],
    ]);
  });

  it('keeps only the bands the range reaches, clipped to it', () => {
    expect(formZoneBands(-20, 0).map((b) => [b.zone, b.from, b.to])).toEqual([
      ['optimal', -20, -10],
      ['greyZone', -10, 0],
    ]);
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(formZoneBands(3, 3)).toEqual([]);
    expect(formZoneBands(5, -5)).toEqual([]);
  });
});

describe('monthTickLabels', () => {
  it('names the month on the first day shown of each month and leaves the rest unlabelled', () => {
    const labels = monthTickLabels(
      ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'],
      'en-GB'
    );
    expect(labels).toEqual(['Jan', null, 'Feb', null]);
  });

  it('is empty for no days', () => {
    expect(monthTickLabels([], 'en-GB')).toEqual([]);
  });
});

describe('decouplingRows', () => {
  const source = {
    activityId: 'a1',
    name: 'Long ride',
    startDateLocal: '2026-05-02T08:00:00',
    decoupling: 4.26,
  };

  it('lists the ride of each span and leaves out a span with none', () => {
    expect(
      decouplingRows([
        { days: 42, source },
        { days: 90, source: null },
      ])
    ).toEqual([
      { days: 42, activityId: 'a1', name: 'Long ride', date: '2026-05-02', decoupling: 4.3 },
    ]);
  });
});
