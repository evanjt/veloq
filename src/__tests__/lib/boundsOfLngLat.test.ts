/**
 * Scenario: a track carries a dropped fix, a NaN or an infinite coordinate.
 * Expected behaviour: the box of the remaining points is returned, so a bad
 * fix never turns the whole box into NaN.
 */

import { boundsOfLngLat } from '@/features/maps/lib/coordinates';

describe('boundsOfLngLat', () => {
  it('skips points that are not finite', () => {
    const box = boundsOfLngLat([
      [6, 46],
      [Number.NaN, 47],
      [8, Number.POSITIVE_INFINITY],
      [7, 45],
    ]);

    expect(box).toEqual({ sw: [6, 45], ne: [7, 46] });
  });

  it('is null when no point is finite, and when there are none', () => {
    expect(boundsOfLngLat([[Number.NaN, 1]])).toBeNull();
    expect(boundsOfLngLat([])).toBeNull();
  });
});
