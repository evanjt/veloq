/**
 * Scenario: an athlete rates a session's effort from 1 to 10 after recording it.
 * Expected behaviour: the rating is drawn in the zone ladder that every other
 * intensity mark uses, effort 1 and 2 in zone 1 up to effort 10 in zone 6, and
 * the slider's swatch, fill and thumb take that zone's fill.
 */

import { rpeZone } from '@/features/recording/lib/rpeZone';

describe('rpeZone', () => {
  it('places each effort from 1 to 10 on the zone ladder', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(rpeZone)).toEqual([1, 1, 2, 2, 3, 4, 4, 5, 5, 6]);
  });

  it('holds an effort outside the scale at its nearer end', () => {
    expect(rpeZone(0)).toBe(1);
    expect(rpeZone(11)).toBe(6);
  });
});
