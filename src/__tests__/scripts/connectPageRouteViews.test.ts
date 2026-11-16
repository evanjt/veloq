/**
 * Scenario: a route's detail draws three views of its attempts (over time, spread, ahead or
 * behind) and an attempts table from the engine's reads.
 *
 * Expected behaviour: each attempt carries its gap to the fastest and its rank, ties sharing a
 * rank; an attempt is ahead of a reference when it took less time; the reference is the one the
 * engine names when it is among the attempts, else the fastest; the spread view draws the
 * engine's bins as they are; the record steps and the delta lines skip what is not a number.
 */

import {
  deltaSeriesOf,
  rankedAttempts,
  recordSteps,
  referenceTimeOf,
  sideOf,
  spreadBins,
  type Attempt,
} from '../../../web/connect/routesDetail';

const attempt = (activityId: string, movingTime: number, date = 0): Attempt => ({
  activityId,
  name: activityId,
  date,
  speed: 1000 / movingTime,
  movingTime,
  isBest: false,
});

/** Little-endian 32-bit floats as the engine sends them, in base64. */
function floatsText(values: number[]): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, at) => view.setFloat32(at * 4, value, true));
  return Buffer.from(bytes).toString('base64');
}

describe('the ranked attempts', () => {
  it('gives each attempt its gap to the fastest and its place, ties sharing one', () => {
    const ranked = rankedAttempts([
      attempt('slow', 700),
      attempt('fast', 600),
      attempt('tie', 600),
      attempt('mid', 650),
    ]);
    const byId = Object.fromEntries(ranked.map((row) => [row.activityId, [row.gap, row.rank]]));
    expect(byId).toEqual({ fast: [0, 1], tie: [0, 1], mid: [50, 3], slow: [100, 4] });
  });

  it('keeps the rows in the order they came', () => {
    const ranked = rankedAttempts([attempt('b', 2), attempt('a', 1)]);
    expect(ranked.map((row) => row.activityId)).toEqual(['b', 'a']);
  });

  it('has no rows for no attempts', () => {
    expect(rankedAttempts([])).toEqual([]);
  });
});

describe('ahead or behind a reference', () => {
  it('is ahead when the attempt took less time, behind when more, level when equal', () => {
    expect(sideOf(590, 600)).toBe('ahead');
    expect(sideOf(610, 600)).toBe('behind');
    expect(sideOf(600, 600)).toBe('level');
  });

  it('takes the reference time from the named attempt when it is among the rows', () => {
    const rows = [attempt('a', 500), attempt('b', 700)];
    expect(referenceTimeOf(rows, 'b')).toBe(700);
  });

  it('falls back to the fastest when none is named or the name is not among the rows', () => {
    const rows = [attempt('a', 500), attempt('b', 700)];
    expect(referenceTimeOf(rows, null)).toBe(500);
    expect(referenceTimeOf(rows, 'gone')).toBe(500);
    expect(referenceTimeOf([], 'gone')).toBeNull();
  });
});

describe('the spread bins', () => {
  it('turns the engine bins into ranges, each as wide as the engine says', () => {
    expect(spreadBins({ startSecs: 600, binWidthSecs: 30, counts: [2, 0, 5] })).toEqual([
      { low: 600, high: 630, count: 2 },
      { low: 630, high: 660, count: 0 },
      { low: 660, high: 690, count: 5 },
    ]);
  });

  it('has no bins for a direction with fewer than three attempts', () => {
    expect(spreadBins(null)).toEqual([]);
  });
});

describe('the record steps', () => {
  it('lists the date and time of each step in the order given', () => {
    expect(
      recordSteps([
        { activityDate: 10, sectionTime: 700 },
        { activityDate: 20, sectionTime: 650 },
      ])
    ).toEqual([
      [10, 700],
      [20, 650],
    ]);
  });

  it('skips a step whose time is not finite', () => {
    expect(
      recordSteps([
        { activityDate: 10, sectionTime: Number.NaN },
        { activityDate: 20, sectionTime: 650 },
      ])
    ).toEqual([[20, 650]]);
  });
});

describe('the delta lines', () => {
  const direction = {
    laps: [
      {
        activityId: 'a',
        deltaSecs: floatsText([0, 2, Number.NaN, 5]),
      },
      { activityId: 'b', deltaSecs: floatsText([0, -1, -2, -3]) },
    ],
    typicalDeltaSecs: floatsText([0, 1, 1, 2]),
  };

  it('places each grid point by the grid step and leaves a gap where the lap is not covered', () => {
    const series = deltaSeriesOf(direction, 'a', 25);
    expect(series.metres).toEqual([0, 25, 50, 75]);
    expect(series.selected).toEqual([0, 2, null, 5]);
    expect(series.typical).toEqual([0, 1, 1, 2]);
  });

  it('has no selected line when the selected attempt has no curve', () => {
    const series = deltaSeriesOf(direction, 'gone', 25);
    expect(series.selected).toBeNull();
    expect(series.typical).toEqual([0, 1, 1, 2]);
  });

  it('has no typical line when the engine sent none', () => {
    const series = deltaSeriesOf({ ...direction, typicalDeltaSecs: null }, 'b', 25);
    expect(series.typical).toBeNull();
    expect(series.selected).toEqual([0, -1, -2, -3]);
  });

  it('has nothing to draw with no direction', () => {
    expect(deltaSeriesOf(null, 'a', 25)).toEqual({ metres: [], selected: null, typical: null });
  });
});
