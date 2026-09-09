/**
 * Scenario: a radius in metres has to be drawn on a map that only sizes its
 * own circles in pixels, so the radius becomes a polygon on the ground.
 *
 * Expected behaviour: the ring closes, every vertex sits the radius from the
 * centre, the bounds enclose it, and a zero radius draws nothing rather than a
 * degenerate ring.
 */

import { circleBounds, circlePolygon, CIRCLE_STEPS } from '@/features/maps/lib/radiusCircle';
import { haversineDistance } from '@/shared/geo/distance';
import type { LngLat } from '@/features/maps/lib/coordinates';

const HOME: LngLat = [7.36, 46.2333];

function ringOf(radiusM: number): LngLat[] {
  const circle = circlePolygon(HOME, radiusM);
  if (!circle) throw new Error(`no circle at ${radiusM} m`);
  return circle.geometry.coordinates[0] as LngLat[];
}

describe('circlePolygon', () => {
  it('closes the ring with one vertex per step plus the repeat', () => {
    const ring = ringOf(100);

    expect(ring).toHaveLength(CIRCLE_STEPS + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('places every vertex the radius from the centre', () => {
    for (const radius of [100, 250, 500]) {
      const ring = ringOf(radius);
      for (const [lng, lat] of ring) {
        const d = haversineDistance(HOME[1], HOME[0], lat, lng);
        expect(Math.abs(d - radius)).toBeLessThan(radius * 0.002);
      }
    }
  });

  it('is a polygon, not a line, so the fill layer can paint it', () => {
    expect(circlePolygon(HOME, 100)?.geometry.type).toBe('Polygon');
  });

  it('draws nothing for a zero or negative radius', () => {
    expect(circlePolygon(HOME, 0)).toBeNull();
    expect(circlePolygon(HOME, -50)).toBeNull();
  });
});

describe('circleBounds', () => {
  it('encloses the whole ring', () => {
    const { sw, ne } = circleBounds(HOME, 500);
    const ring = ringOf(500);

    for (const [lng, lat] of ring) {
      expect(lng).toBeGreaterThanOrEqual(sw[0] - 1e-9);
      expect(lng).toBeLessThanOrEqual(ne[0] + 1e-9);
      expect(lat).toBeGreaterThanOrEqual(sw[1] - 1e-9);
      expect(lat).toBeLessThanOrEqual(ne[1] + 1e-9);
    }
  });

  it('spans the diameter on each axis', () => {
    const { sw, ne } = circleBounds(HOME, 250);

    expect(haversineDistance(sw[1], HOME[0], ne[1], HOME[0])).toBeCloseTo(500, -1);
    expect(haversineDistance(HOME[1], sw[0], HOME[1], ne[0])).toBeCloseTo(500, -1);
  });
});
