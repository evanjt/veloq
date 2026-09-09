/**
 * Scenario: chart series arrive at full stream resolution and may carry gaps.
 * Expected behaviour: extents skip non-finite samples, report the empty case
 * rather than returning Infinity, and survive a stream long enough to exceed
 * the spread argument limit.
 */
import { finiteExtent } from '@/shared/charts/extent';

describe('finiteExtent', () => {
  it('reports min and max over finite samples', () => {
    expect(finiteExtent([3, 1, 4, 1, 5])).toEqual({ min: 1, max: 5 });
  });

  it('skips non-finite samples rather than poisoning the extent', () => {
    expect(finiteExtent([NaN, 2, Infinity, 8, -Infinity])).toEqual({ min: 2, max: 8 });
  });

  it('returns null when nothing is finite', () => {
    expect(finiteExtent([])).toBeNull();
    expect(finiteExtent([NaN, Infinity])).toBeNull();
  });

  it('handles a stream longer than the spread argument limit', () => {
    const long = new Array(300_000);
    for (let i = 0; i < long.length; i += 1) long[i] = i;
    expect(() => Math.max(...long)).toThrow();
    expect(finiteExtent(long)).toEqual({ min: 0, max: 299_999 });
  });
});
