/**
 * Scenario: the engine shades a trained muscle by its weighted sets as a share
 * of the most trained muscle's, rounded up to one of five steps, and the legend
 * labels each step with the most sets it covers.
 *
 * Expected behaviour: the ceilings split the most trained muscle's sets into
 * five equal steps, the last at the maximum itself, rounded to a tenth.
 */

import { volumeStepCeilings } from '@/features/strength/lib/volumeSteps';

describe('volumeStepCeilings', () => {
  it('splits the most sets into five equal steps ending at the maximum', () => {
    expect(volumeStepCeilings(12)).toEqual([2.4, 4.8, 7.2, 9.6, 12]);
  });

  it('rounds each ceiling to a tenth of a set', () => {
    expect(volumeStepCeilings(7.5)).toEqual([1.5, 3, 4.5, 6, 7.5]);
    expect(volumeStepCeilings(1)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
    expect(volumeStepCeilings(3.3)).toEqual([0.7, 1.3, 2, 2.6, 3.3]);
  });

  it('gives five zero ceilings for a period with nothing trained', () => {
    expect(volumeStepCeilings(0)).toEqual([0, 0, 0, 0, 0]);
  });

  it('treats a value that is not a finite count as nothing trained', () => {
    expect(volumeStepCeilings(Number.NaN)).toEqual([0, 0, 0, 0, 0]);
    expect(volumeStepCeilings(-3)).toEqual([0, 0, 0, 0, 0]);
  });
});
