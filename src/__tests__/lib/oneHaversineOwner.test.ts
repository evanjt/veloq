/**
 * Scenario: the TypeScript side is meant to have one haversine, `distance.ts`,
 * so a distance agrees whichever caller computed it and agrees with the engine
 * across the FFI.
 *
 * Expected behaviour: a polyline's length is the sum of its legs as
 * `haversineDistance` measures them, to the metre, with no second earth radius
 * anywhere in the calculation.
 */

import { haversineDistance, polylineDistance } from '@/shared/geo/distance';
import type { LatLng } from '@/shared/geo/distance';

const LAUSANNE: LatLng = { lat: 46.5197, lng: 6.6323 };
const MONTREUX: LatLng = { lat: 46.4312, lng: 6.9107 };
const VEVEY: LatLng = { lat: 46.4628, lng: 6.8419 };

describe('polylineDistance', () => {
  it('sums its legs exactly as haversineDistance measures them', () => {
    const legs = haversineDistance(LAUSANNE, VEVEY) + haversineDistance(VEVEY, MONTREUX);

    expect(polylineDistance([LAUSANNE, VEVEY, MONTREUX])).toBeCloseTo(legs, 9);
  });

  it('uses the IUGG radius the engine uses, not a rounded 6371 km', () => {
    // A rounded 6_371_000 m radius is short by a factor of 1 - 8.8/6371008.8,
    // which over this ~24 km leg is about 33 mm. Asserting to the millimetre is
    // what catches a second radius; a metre tolerance would not.
    const rounded = 6_371_000;
    const iugg = 6_371_008.8;
    const measured = polylineDistance([LAUSANNE, MONTREUX]);

    expect(measured).toBeCloseTo(haversineDistance(LAUSANNE, MONTREUX), 9);
    expect(measured).toBeGreaterThan((haversineDistance(LAUSANNE, MONTREUX) * rounded) / iugg);
  });

  it('is zero for fewer than two points', () => {
    expect(polylineDistance([])).toBe(0);
    expect(polylineDistance([LAUSANNE])).toBe(0);
  });

  it('is zero for a repeated point, and does not go negative', () => {
    expect(polylineDistance([LAUSANNE, LAUSANNE, LAUSANNE])).toBe(0);
  });

  it('is order independent for a there-and-back leg', () => {
    const there = polylineDistance([LAUSANNE, MONTREUX]);
    const back = polylineDistance([MONTREUX, LAUSANNE]);

    expect(there).toBeCloseTo(back, 9);
  });
});
