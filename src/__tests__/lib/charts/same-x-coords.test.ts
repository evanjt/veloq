/**
 * Scenario: a chart's cached snap positions are kept from one layout to the
 * next, and a layout whose only change is an interior point must replace them,
 * or a scrub selects the sample nearest the old position.
 *
 * Expected behaviour: the cache is reused only when every position matches in
 * order, so a change at any index, including one that is neither the first nor
 * the last, reads as changed.
 */

import { sameXCoords } from '@/shared/charts/sameXCoords';

const at = (x: number) => ({ x });
const identity = (p: { x: number }) => p.x;

describe('sameXCoords', () => {
  it('matches an empty cache against no points', () => {
    expect(sameXCoords([], [], identity)).toBe(true);
  });

  it('does not match an empty cache against points', () => {
    expect(sameXCoords([], [at(0)], identity)).toBe(false);
  });

  it('does not match a cache against a different count of points', () => {
    expect(sameXCoords([0, 10], [at(0), at(10), at(20)], identity)).toBe(false);
    expect(sameXCoords([0, 10, 20], [at(0), at(10)], identity)).toBe(false);
  });

  it('matches when every position is the same', () => {
    expect(sameXCoords([0, 10, 100], [at(0), at(10), at(100)], identity)).toBe(true);
  });

  it('does not match when only the first position moved', () => {
    expect(sameXCoords([0, 10, 100], [at(1), at(10), at(100)], identity)).toBe(false);
  });

  it('does not match when only the last position moved', () => {
    expect(sameXCoords([0, 10, 100], [at(0), at(10), at(99)], identity)).toBe(false);
  });

  it('does not match when only an interior position moved', () => {
    expect(sameXCoords([0, 10, 100], [at(0), at(60), at(100)], identity)).toBe(false);
  });

  it('matches a single point whose position is unchanged', () => {
    expect(sameXCoords([42], [at(42)], identity)).toBe(true);
  });

  it('reads positions through getX, not the point itself', () => {
    const scaled = (p: { x: number }) => p.x * 2;
    expect(sameXCoords([0, 20, 200], [at(0), at(10), at(100)], scaled)).toBe(true);
    expect(sameXCoords([0, 10, 200], [at(0), at(10), at(100)], scaled)).toBe(false);
  });
});
