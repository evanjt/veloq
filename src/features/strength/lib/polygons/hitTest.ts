import { FRONT_POSITIONS, BACK_POSITIONS } from '../muscleHitRegions';

import { FRONT_MALE, BACK_MALE } from './male.generated';
import { FRONT_FEMALE, BACK_FEMALE } from './female.generated';

export type Polygon = number[][];
export type MusclePolygons = Record<string, Polygon[]>;

const PRIORITY: string[] = [
  'deltoids',
  'biceps',
  'triceps',
  'forearm',
  'chest',
  'abs',
  'quadriceps',
  'hamstring',
  'calves',
  'gluteal',
  'adductors',
  'obliques',
  'trapezius',
  'upper-back',
  'lower-back',
];

export type BodyGender = 'male' | 'female';

const POLYGONS: Record<BodyGender, Record<'front' | 'back', MusclePolygons>> = {
  male: { front: FRONT_MALE, back: BACK_MALE },
  female: { front: FRONT_FEMALE, back: BACK_FEMALE },
};

function pip(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1],
      xj = poly[j][0],
      yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Polygon point-in-shape first (priority ordered), then nearest center fallback.
export function findMuscleAtPoint(
  nx: number,
  ny: number,
  side: 'front' | 'back',
  tappableSlugs: Set<string>,
  gender: BodyGender = 'male'
): string | null {
  const polys = POLYGONS[gender][side];
  for (const slug of PRIORITY) {
    if (!tappableSlugs.has(slug)) continue;
    const pl = polys[slug];
    if (!pl) continue;
    for (const p of pl) {
      if (pip(nx, ny, p)) return slug;
    }
  }

  const positions = side === 'front' ? FRONT_POSITIONS : BACK_POSITIONS;
  const THRESHOLD = 0.08;
  let nearest: string | null = null;
  let nearestDist = THRESHOLD;
  for (const [slug, regions] of Object.entries(positions)) {
    if (!tappableSlugs.has(slug)) continue;
    for (const pos of regions) {
      const dx = nx - pos.x;
      const dy = ny - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = slug;
      }
    }
  }
  return nearest;
}
