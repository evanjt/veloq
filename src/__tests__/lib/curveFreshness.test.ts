/**
 * Scenario: the Performance and Season Bests headers drew a curve fetched weeks
 * ago as though it were current, and a curve never fetched looked the same as
 * an empty one.
 *
 * Expected behaviour: a stored curve is dated from the fetch behind it, a curve
 * that has never been stored says so, and neither line appears while the first
 * fetch is still in flight.
 */

import { curveFreshness } from '@/features/stats/lib/curveFreshness';

describe('the freshness line under a curve header', () => {
  it('dates a stored curve from the body behind it', () => {
    expect(curveFreshness({ fetchedAt: 1_754_600_000_000, isLoading: false })).toEqual({
      kind: 'dated',
      fetchedAt: 1_754_600_000_000,
    });
  });

  it('dates a stored curve even while a refresh is in flight', () => {
    expect(curveFreshness({ fetchedAt: 1_754_600_000_000, isLoading: true })).toEqual({
      kind: 'dated',
      fetchedAt: 1_754_600_000_000,
    });
  });

  it('says a curve has never been downloaded', () => {
    expect(curveFreshness({ fetchedAt: null, isLoading: false })).toEqual({ kind: 'never' });
    expect(curveFreshness({ fetchedAt: undefined, isLoading: false })).toEqual({ kind: 'never' });
  });

  it('says nothing while the first fetch is still in flight', () => {
    expect(curveFreshness({ fetchedAt: null, isLoading: true })).toBeNull();
  });

  it('reads a stamp that is not a time as never fetched', () => {
    expect(curveFreshness({ fetchedAt: 0, isLoading: false })).toEqual({ kind: 'never' });
    expect(curveFreshness({ fetchedAt: -1, isLoading: false })).toEqual({ kind: 'never' });
    expect(curveFreshness({ fetchedAt: NaN, isLoading: false })).toEqual({ kind: 'never' });
  });
});
