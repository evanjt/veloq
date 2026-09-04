/**
 * Scenario: distance is computed in both languages. Rust uses the geo crate's
 * Haversine over MEAN_EARTH_RADIUS, TypeScript uses shared/geo/distance.ts.
 *
 * Expected behaviour: both agree. The fixtures below are shared with the Rust
 * test of the same name in veloqrs/src/persistence/mod.rs, so a change to
 * either radius or formula fails on both sides rather than drifting silently.
 */
import { haversineDistance } from '@/shared/geo/distance';

// [lat1, lng1, lat2, lng2, expected metres]
const FIXTURES: [number, number, number, number, number][] = [
  [46.2044, 6.1432, 46.5197, 6.6323, 51_359.28], // Geneva to Lausanne
  [46.2276, 7.3597, 46.2276, 7.3597, 0], // identical points
  [-37.8136, 144.9631, -33.8688, 151.2093, 713_428.47], // Melbourne to Sydney
  [0, 0, 0, 1, 111_195.08], // one degree of longitude at the equator
  [0, 0, 1, 0, 111_195.08], // one degree of latitude
];

describe('haversine parity with the Rust engine', () => {
  it.each(FIXTURES)('(%p, %p) to (%p, %p) is %p m', (lat1, lng1, lat2, lng2, expected) => {
    const actual = haversineDistance(lat1, lng1, lat2, lng2);
    // 0.01% tolerance: same formula and radius, so only float ordering differs.
    expect(actual).toBeCloseTo(expected, expected > 1000 ? -1 : 5);
  });

  it('uses the IUGG mean radius that the geo crate uses', () => {
    // Half a great circle. 20,015,114.44 m over the mean radius, not 20,015,086.80
    // over the 6,371,000 radius the hand-rolled copies used.
    expect(haversineDistance(0, 0, 0, 180)).toBeCloseTo(20_015_114.44, 0);
  });

  it('accepts both call forms identically', () => {
    const asPoints = haversineDistance(
      { lat: 46.2044, lng: 6.1432 },
      { lat: 46.5197, lng: 6.6323 }
    );
    const asScalars = haversineDistance(46.2044, 6.1432, 46.5197, 6.6323);
    expect(asPoints).toBe(asScalars);
  });
});
