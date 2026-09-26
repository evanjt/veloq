/**
 * Scenario: four charts and the wellness summary each show Form, and each one
 * rounds fitness and fatigue before subtracting so the number matches
 * intervals.icu. `tsbFromLoads` subtracts unrounded, so the two disagree by up
 * to a unit and every caller was doing the rounding by hand.
 *
 * Expected behaviour: one function that rounds first, and the same answer
 * everywhere it is shown.
 */
import { formFromLoads, tsbFromLoads } from '@/shared/math';

describe('formFromLoads', () => {
  it('rounds each load before subtracting, as the charts display them', () => {
    expect(formFromLoads(50.4, 30.6)).toBe(19);
    expect(tsbFromLoads(50.4, 30.6)).toBeCloseTo(19.8);
  });

  it('agrees with the unrounded form when both loads are whole', () => {
    expect(formFromLoads(50, 30)).toBe(20);
  });

  it('is negative when fatigue leads', () => {
    expect(formFromLoads(30, 50)).toBe(-20);
  });

  it('reads a missing load as zero, which is what a chart draws', () => {
    expect(formFromLoads(undefined, 30)).toBe(-30);
    expect(formFromLoads(50, null)).toBe(50);
    expect(formFromLoads(null, undefined)).toBe(0);
  });

  it('reads a non-finite load as zero rather than propagating NaN', () => {
    expect(formFromLoads(NaN, 30)).toBe(-30);
    expect(formFromLoads(50, Infinity)).toBe(50);
  });

  it('rounds half away from zero the way Math.round does, so it matches the axis', () => {
    expect(formFromLoads(0.5, 0)).toBe(1);
    expect(formFromLoads(0, 0.5)).toBe(-1);
  });
});
