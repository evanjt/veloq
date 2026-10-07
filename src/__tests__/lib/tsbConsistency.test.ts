/**
 * Form is `tsbFromLoads`: CTL minus ATL, null when either load is missing. The
 * chart reads it through `formFromLoads`, which rounds each load and counts a
 * missing one as 0.
 *
 * Imports use deep paths (not '@/features/fitness') so no feature barrel pulls
 * a native module into the pure-logic test.
 */

import { tsbFromLoads, formFromLoads } from '@/shared/math/trainingLoad';

describe('TSB consistency', () => {
  const pairs: [number, number][] = [
    [50, 50],
    [60, 40],
    [40, 60],
    [0, 0],
    [-10, 5],
    [100, 0],
  ];

  it.each(pairs)('tsbFromLoads is ctl - atl for ctl=%p atl=%p', (ctl, atl) => {
    expect(tsbFromLoads(ctl, atl)).toBe(ctl - atl);
  });

  it('returns null when ctl, atl or both are missing', () => {
    expect(tsbFromLoads(undefined, 40)).toBeNull();
    expect(tsbFromLoads(50, undefined)).toBeNull();
    expect(tsbFromLoads(undefined, undefined)).toBeNull();
  });

  it('formFromLoads treats a missing load as 0, so the chart never drops a day', () => {
    expect(formFromLoads(undefined, 40)).toBe(-40);
    expect(formFromLoads(50, undefined)).toBe(50);
    expect(formFromLoads(undefined, undefined)).toBe(0);
  });
});
