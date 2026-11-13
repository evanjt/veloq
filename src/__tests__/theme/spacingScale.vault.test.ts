/**
 * Scenario: a second set of names for values already on the spacing ladder lets
 * a gap drift off the ladder under a name nothing else reads.
 *
 * Expected behaviour: the spacing scale is one flat ladder, every rung a number
 * under one name, ascending in the order it is declared.
 */

import { spacing } from '@/theme/spacing';

describe('the spacing scale', () => {
  it('has no sub-scale, only numeric rungs', () => {
    for (const [name, value] of Object.entries(spacing)) {
      expect([name, typeof value]).toEqual([name, 'number']);
    }
  });

  it('names each value once, in ascending order', () => {
    const values = Object.values(spacing) as number[];
    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});
