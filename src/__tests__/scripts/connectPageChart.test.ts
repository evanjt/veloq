/**
 * Scenario: the activity page draws its series as lines sharing one x axis,
 * switchable between distance and time, with a crosshair that reads every
 * visible series at the pointer.
 *
 * Expected behaviour: a pointer position names the same sample on either axis
 * as the sample's own position on that axis; a gap in a series breaks its line
 * rather than bridging it; hiding a series leaves the x extent and the other
 * series' ranges as they were; the crosshair reports visible series only.
 */

import {
  axisRange,
  crosshair,
  indexAtX,
  linePath,
  seriesRange,
  xOf,
  type ChartData,
} from '../../../web/connect/chart';

// A stop in the middle: time keeps passing while distance does not move.
const ride: ChartData = {
  time: [0, 10, 20, 30, 40, 50, 60],
  distance: [0, 100, 300, 300, 300, 500, 800],
  series: {
    heartrate: [100, 110, 120, NaN, NaN, 140, 150],
    watts: [0, 150, 250, 0, 0, 300, 400],
  },
};
const WIDTH = 600;

describe('the pointer and the sample index', () => {
  it.each(['distance', 'time'] as const)('round-trips every sample on the %s axis', (axis) => {
    const seen = new Set<number>();
    for (let i = 0; i < ride.time.length; i++) {
      const found = indexAtX(ride, axis, xOf(ride, axis, i, WIDTH), WIDTH)!;
      // Samples sharing a distance share a place: the pointer lands on one of them.
      expect(ride[axis][found]).toBe(ride[axis][i]);
      seen.add(found);
    }
    if (axis === 'time') expect(seen.size).toBe(ride.time.length);
  });

  it('puts one sample at different places on the two axes but names it from either', () => {
    const i = 5;
    const onDistance = xOf(ride, 'distance', i, WIDTH);
    const onTime = xOf(ride, 'time', i, WIDTH);
    expect(onDistance).not.toBeCloseTo(onTime);
    expect(indexAtX(ride, 'distance', onDistance, WIDTH)).toBe(i);
    expect(indexAtX(ride, 'time', onTime, WIDTH)).toBe(i);
  });

  it('clamps a pointer outside the plot to the first and last sample', () => {
    expect(indexAtX(ride, 'time', -50, WIDTH)).toBe(0);
    expect(indexAtX(ride, 'time', WIDTH + 50, WIDTH)).toBe(6);
  });

  it('answers index 0 for a ride with one sample and null for none', () => {
    expect(indexAtX({ time: [5], distance: [0], series: {} }, 'time', 100, WIDTH)).toBe(0);
    expect(indexAtX({ time: [], distance: [], series: {} }, 'time', 100, WIDTH)).toBeNull();
  });
});

describe('a line with a gap', () => {
  it('starts a new subpath after a gap and draws nothing through it', () => {
    const path = linePath(ride, 'time', 'heartrate', WIDTH, 100);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path.match(/L/g)).toHaveLength(2 + 1);
  });

  it('draws a lone sample between two gaps as a dot, not nothing', () => {
    const data: ChartData = {
      time: [0, 1, 2, 3, 4],
      distance: [0, 1, 2, 3, 4],
      series: { temp: [NaN, 5, NaN, 6, 7] },
    };
    const path = linePath(data, 'time', 'temp', WIDTH, 100);
    expect(path.match(/M/g)).toHaveLength(2);
  });

  it('is empty for a series the ride does not have or one that is all gaps', () => {
    expect(linePath(ride, 'time', 'cadence', WIDTH, 100)).toBe('');
    const empty: ChartData = { ...ride, series: { cadence: [NaN, NaN, NaN, NaN, NaN, NaN, NaN] } };
    expect(linePath(empty, 'time', 'cadence', WIDTH, 100)).toBe('');
  });
});

describe('toggling a series', () => {
  it('leaves the x extent and the other series ranges unchanged', () => {
    const before = {
      x: axisRange(ride, 'distance'),
      watts: seriesRange(ride, 'watts'),
    };
    const without: ChartData = {
      ...ride,
      series: { watts: ride.series.watts! },
    };
    expect(axisRange(without, 'distance')).toEqual(before.x);
    expect(seriesRange(without, 'watts')).toEqual(before.watts);
  });

  it('ranges a series over its finite samples only', () => {
    expect(seriesRange(ride, 'heartrate')).toEqual({ low: 100, high: 150 });
    expect(seriesRange(ride, 'cadence')).toBeNull();
  });

  it('gives a flat series a span so its line sits mid-plot', () => {
    const flat: ChartData = { ...ride, series: { watts: [200, 200, 200, 200, 200, 200, 200] } };
    const range = seriesRange(flat, 'watts')!;
    expect(range.high).toBeGreaterThan(range.low);
  });
});

describe('the crosshair', () => {
  it('reports every visible series at the sample and none that is hidden', () => {
    const at = crosshair(ride, ['watts', 'heartrate'], 5);
    expect(at).toEqual({
      index: 5,
      time: 50,
      distance: 500,
      values: [
        { key: 'watts', value: 300 },
        { key: 'heartrate', value: 140 },
      ],
    });
    expect(crosshair(ride, ['watts'], 5)?.values.map((v) => v.key)).toEqual(['watts']);
  });

  it('leaves out a series with a gap at that sample', () => {
    expect(crosshair(ride, ['heartrate', 'watts'], 3)?.values).toEqual([
      { key: 'watts', value: 0 },
    ]);
  });

  it('is null for an index outside the ride', () => {
    expect(crosshair(ride, ['watts'], 99)).toBeNull();
    expect(crosshair(ride, ['watts'], -1)).toBeNull();
  });
});
