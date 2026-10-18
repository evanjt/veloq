/**
 * Scenario: a sparkline spaced its points evenly by index, so two attempts a
 * day apart and a third a month later read as three equal steps, and the gap
 * the athlete took off was invisible.
 *
 * Expected behaviour: points carrying dates sit at their date along the plot,
 * a higher value sits higher unless the axis is inverted, a flat series runs
 * down the middle, and a series with no time to spread over is spaced evenly.
 */

import { sparklinePlacement } from '@/shared/charts/sparklinePlacement';

const DAY = 86_400;
const BOX = { width: 106, height: 32, pad: 3 };

describe('sparklinePlacement', () => {
  it('places points by date, so a long gap reads as one', () => {
    const start = 1_700_000_000;
    const { points } = sparklinePlacement(
      [10, 11, 12],
      [start, start + DAY, start + 31 * DAY],
      BOX
    );

    const first = points[0]!;
    const second = points[1]!;
    const third = points[2]!;
    expect(first.x).toBe(BOX.pad);
    expect(third.x).toBe(BOX.width - BOX.pad);
    expect(second.x - first.x).toBeCloseTo((third.x - first.x) / 31, 6);
    expect(third.x - second.x).toBeGreaterThan(20 * (second.x - first.x));
  });

  it('spaces points evenly when there are no dates', () => {
    const { points } = sparklinePlacement([10, 11, 12], undefined, BOX);

    expect(points.map((p) => p.x)).toEqual([3, 53, 103]);
  });

  it('spaces points evenly when every point shares one date', () => {
    const { points } = sparklinePlacement([10, 11, 12], [5, 5, 5], BOX);

    expect(points.map((p) => p.x)).toEqual([3, 53, 103]);
  });

  it('spaces points evenly when the dates do not line up with the values', () => {
    const { points } = sparklinePlacement([10, 11, 12], [0, DAY], BOX);

    expect(points.map((p) => p.x)).toEqual([3, 53, 103]);
  });

  it('draws a higher value higher, and reports the low and the high', () => {
    const { points, min, max } = sparklinePlacement([46, 50, 48], undefined, BOX);

    expect(min).toBe(46);
    expect(max).toBe(50);
    expect(points[1]!.y).toBe(BOX.pad);
    expect(points[0]!.y).toBe(BOX.height - BOX.pad);
    expect(points[2]!.y).toBe(16);
  });

  it('draws a higher value lower on an inverted axis', () => {
    const { points } = sparklinePlacement([46, 50], undefined, { ...BOX, invert: true });

    expect(points[0]!.y).toBe(BOX.pad);
    expect(points[1]!.y).toBe(BOX.height - BOX.pad);
  });

  it('runs a flat series down the middle', () => {
    const { points } = sparklinePlacement([7, 7, 7], undefined, BOX);

    expect(points.map((p) => p.y)).toEqual([16, 16, 16]);
  });

  it('centres a single point', () => {
    const { points } = sparklinePlacement([7], [DAY], BOX);

    expect(points).toEqual([{ x: 53, y: 16 }]);
  });

  it('places nothing for an empty series', () => {
    expect(sparklinePlacement([], [], BOX)).toEqual({ points: [], min: 0, max: 0 });
  });
});
