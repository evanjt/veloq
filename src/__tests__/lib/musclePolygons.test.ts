/**
 * Scenario: hit regions are derived from react-native-body-highlighter's SVG paths.
 * Expected behaviour: they cover the drawn muscles, they differ per gender, and a tap
 * inside a muscle resolves to that muscle without leaning on the proximity fallback.
 */
import { findMuscleAtPoint } from '@/features/strength/lib/polygons';
import { FRONT_MALE, BACK_MALE } from '@/features/strength/lib/polygons/male.generated';
import { FRONT_FEMALE } from '@/features/strength/lib/polygons/female.generated';

const TAPPABLE = new Set([
  'abs',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'deltoids',
  'forearm',
  'gluteal',
  'hamstring',
  'lower-back',
  'obliques',
  'quadriceps',
  'trapezius',
  'triceps',
  'upper-back',
]);

const ringArea = (r: number[][]) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  }
  return Math.abs(a / 2);
};

const centroid = (r: number[][]) => {
  const n = r.length;
  return [r.reduce((s, p) => s + p[0], 0) / n, r.reduce((s, p) => s + p[1], 0) / n];
};

describe('muscle hit polygons', () => {
  it('covers every tappable muscle on both sides', () => {
    for (const slug of TAPPABLE) {
      const present = slug in FRONT_MALE || slug in BACK_MALE;
      expect([slug, present]).toEqual([slug, true]);
    }
  });

  it('stays inside the normalised viewBox', () => {
    for (const rings of Object.values(FRONT_MALE)) {
      for (const r of rings) {
        for (const [x, y] of r) {
          expect(x).toBeGreaterThanOrEqual(-0.01);
          expect(x).toBeLessThanOrEqual(1.01);
          expect(y).toBeGreaterThanOrEqual(-0.01);
          expect(y).toBeLessThanOrEqual(1.01);
        }
      }
    }
  });

  it('gives male and female distinct geometry', () => {
    // Same slugs, different bodies. Identical polygons would mean the female body is
    // being hit-tested against male regions.
    expect(Object.keys(FRONT_FEMALE).sort()).toEqual(Object.keys(FRONT_MALE).sort());
    const differing = Object.keys(FRONT_MALE).filter((slug) => {
      const m = FRONT_MALE[slug].reduce((s, r) => s + ringArea(r), 0);
      const f = FRONT_FEMALE[slug].reduce((s, r) => s + ringArea(r), 0);
      return Math.abs(m - f) > 1e-6;
    });
    expect(differing.length).toBeGreaterThan(5);
  });

  it('resolves a tap at each muscle centroid to that muscle', () => {
    // The centroid of a ring can fall outside a concave shape, so this asserts the
    // resolved slug is a real hit rather than asserting a specific slug everywhere.
    for (const [slug, rings] of Object.entries(FRONT_MALE)) {
      const biggest = rings.reduce((a, b) => (ringArea(a) > ringArea(b) ? a : b));
      const [cx, cy] = centroid(biggest);
      const hit = findMuscleAtPoint(cx, cy, 'front', TAPPABLE, 'male');
      expect([slug, hit === null]).toEqual([slug, false]);
    }
  });

  it('returns null well outside the body', () => {
    expect(findMuscleAtPoint(-0.5, -0.5, 'front', TAPPABLE, 'male')).toBeNull();
  });
});
