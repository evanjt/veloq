/**
 * Scenario: a section chart drawn on the time axis, tapped near the top edge.
 * Expected behaviour: the tap resolves against the axis the chart draws, so a
 * traversal that is fastest by time wins even when another is fastest by speed.
 * The two disagree whenever the matched portion's distance varies between
 * traversals.
 */

import { nearestScatterPointIndex } from '@/features/routes/lib/scatterData';

const NEAR_TOP = { x: 0.5, y: 0.05 };
const NEAR_BOTTOM = { x: 0.5, y: 0.95 };

describe('nearestScatterPointIndex', () => {
  it('picks the shortest time when the chart draws the time axis', () => {
    const points = [
      { x: 0.5, y: 100 },
      { x: 0.5, y: 200 },
    ];
    expect(nearestScatterPointIndex(points, NEAR_TOP, [200, 100])).toBe(0);
    expect(nearestScatterPointIndex(points, NEAR_BOTTOM, [200, 100])).toBe(1);
  });

  it('picks the highest speed when the chart draws the speed axis', () => {
    const points = [
      { x: 0.5, y: 5 },
      { x: 0.5, y: 8 },
    ];
    expect(nearestScatterPointIndex(points, NEAR_TOP, [5, 8])).toBe(1);
    expect(nearestScatterPointIndex(points, NEAR_BOTTOM, [5, 8])).toBe(0);
  });

  it('does not fall back to the speed ranking on a time-axis chart', () => {
    // Traversal 0 is the fastest by time and the slowest by speed, which is
    // what a shorter matched portion looks like.
    const byTime = [
      { x: 0.5, y: 100 },
      { x: 0.5, y: 200 },
    ];
    expect(nearestScatterPointIndex(byTime, NEAR_TOP, [200, 100])).toBe(0);
  });

  it('separates on x when the y values tie', () => {
    const points = [
      { x: 0.1, y: 10 },
      { x: 0.9, y: 10 },
    ];
    expect(nearestScatterPointIndex(points, { x: 0.85, y: 0.5 }, [10, 10])).toBe(1);
  });

  it('skips points with no value on the drawn axis', () => {
    const points = [
      { x: 0.5, y: null },
      { x: 0.5, y: Number.NaN },
      { x: 0.5, y: 42 },
    ];
    expect(nearestScatterPointIndex(points, NEAR_TOP, [0, 100])).toBe(2);
  });

  it('returns -1 for an empty set and for one with no drawable value', () => {
    expect(nearestScatterPointIndex([], NEAR_TOP, [0, 1])).toBe(-1);
    expect(nearestScatterPointIndex([{ x: 0, y: null }], NEAR_TOP, [0, 1])).toBe(-1);
  });
});
