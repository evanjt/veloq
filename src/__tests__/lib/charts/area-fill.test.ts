/**
 * Expected behaviour: an area under a line is drawn only when the axis it
 * fills down to starts at zero, so the fill never reads as a quantity the
 * data does not have.
 */

import { areaFillsFromZero, areaWashOpacity } from '@/shared/charts/areaFill';
import { opacity } from '@/theme';

describe('areaFillsFromZero', () => {
  it('fills an ascending domain whose floor is zero', () => {
    expect(areaFillsFromZero([0, 400])).toBe(true);
  });

  it('draws no fill on a raised axis', () => {
    expect(areaFillsFromZero([240, 266])).toBe(false);
  });

  it('draws no fill on an inverted domain', () => {
    expect(areaFillsFromZero([266, 240])).toBe(false);
    expect(areaFillsFromZero([400, 0])).toBe(false);
  });

  it('draws no fill on a domain whose floor sits below zero', () => {
    expect(areaFillsFromZero([-5, 100])).toBe(false);
  });

  it('draws no fill on an empty or non-finite domain', () => {
    expect(areaFillsFromZero([0, 0])).toBe(false);
    expect(areaFillsFromZero([0, Number.NaN])).toBe(false);
    expect(areaFillsFromZero([0, Number.POSITIVE_INFINITY])).toBe(false);
  });
});

describe('areaWashOpacity', () => {
  it('reads the first tint step in light and the second in dark', () => {
    expect(areaWashOpacity(false)).toBe(opacity.tint1);
    expect(areaWashOpacity(true)).toBe(opacity.tint2);
  });
});
