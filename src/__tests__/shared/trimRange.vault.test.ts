/**
 * Scenario: a trim bound is stepped by a button, a screen reader action or a drag.
 * Expected behaviour: the bound moves by the step, stops at the minimum gap from the
 * other bound, never leaves 0 to maxIndex, and never moves against the step when the
 * range it was handed is already tighter than the gap.
 */
import { stepTrimBound, trimMinGap } from '@/shared/math/trimRange';

describe('stepTrimBound', () => {
  it('moves the start by the step', () => {
    expect(stepTrimBound(10, 80, 100, 'start', 1, 5)).toBe(11);
    expect(stepTrimBound(10, 80, 100, 'start', -3, 5)).toBe(7);
  });

  it('moves the end by the step', () => {
    expect(stepTrimBound(10, 80, 100, 'end', 1, 5)).toBe(81);
    expect(stepTrimBound(10, 80, 100, 'end', -4, 5)).toBe(76);
  });

  it('stops the start at the minimum gap from the end', () => {
    expect(stepTrimBound(70, 80, 100, 'start', 20, 5)).toBe(75);
    expect(stepTrimBound(75, 80, 100, 'start', 1, 5)).toBe(75);
  });

  it('stops the end at the minimum gap from the start', () => {
    expect(stepTrimBound(10, 30, 100, 'end', -50, 5)).toBe(15);
    expect(stepTrimBound(10, 15, 100, 'end', -1, 5)).toBe(15);
  });

  it('never carries the start below 0 or the end past maxIndex', () => {
    expect(stepTrimBound(2, 80, 100, 'start', -10, 5)).toBe(0);
    expect(stepTrimBound(0, 80, 100, 'start', -1, 5)).toBe(0);
    expect(stepTrimBound(10, 98, 100, 'end', 10, 5)).toBe(100);
    expect(stepTrimBound(10, 100, 100, 'end', 1, 5)).toBe(100);
  });

  it('leaves a bound in place rather than moving it against the step', () => {
    // A range already tighter than the gap, as a wider handle can leave it.
    expect(stepTrimBound(78, 80, 100, 'start', 1, 5)).toBe(78);
    expect(stepTrimBound(78, 80, 100, 'end', -1, 5)).toBe(80);
    expect(stepTrimBound(78, 80, 100, 'start', -1, 5)).toBe(77);
    expect(stepTrimBound(78, 80, 100, 'end', 1, 5)).toBe(81);
  });

  it('does not move either bound when the gap is wider than the track', () => {
    expect(stepTrimBound(0, 3, 3, 'start', 1, 5)).toBe(0);
    expect(stepTrimBound(0, 3, 3, 'end', -1, 5)).toBe(3);
  });

  it('a zero step leaves the bound where it is', () => {
    expect(stepTrimBound(10, 80, 100, 'start', 0, 5)).toBe(10);
    expect(stepTrimBound(10, 80, 100, 'end', 0, 5)).toBe(80);
  });
});

describe('trimMinGap', () => {
  it('is five per cent of the range, rounded up, with no track width', () => {
    expect(trimMinGap(100)).toBe(5);
    expect(trimMinGap(101)).toBe(6);
    expect(trimMinGap(10)).toBe(1);
  });

  it('is one handle width when the handle covers more of the track than five per cent', () => {
    // A 240 dp track with a 28 dp handle: the handle spans 11.7 per cent.
    expect(trimMinGap(10_000, 240, 28)).toBe(1167);
  });

  it('stays at five per cent when the handle is narrower than that', () => {
    expect(trimMinGap(1000, 1000, 28)).toBe(50);
  });

  it('is zero for a range with a single point', () => {
    expect(trimMinGap(0, 240, 28)).toBe(0);
  });

  it('ignores a track that has not been measured yet', () => {
    expect(trimMinGap(100, 0, 28)).toBe(5);
  });
});
