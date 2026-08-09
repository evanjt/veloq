import { FRONT_POSITIONS, BACK_POSITIONS } from '../muscleHitRegions';

import { FRONT_QUADRICEPS } from './quads';
import { BACK_HAMSTRING } from './hamstrings';
import { BACK_GLUTEAL } from './glutes';
import { FRONT_CALVES, BACK_CALVES } from './calves';
import { FRONT_CHEST } from './chest';
import { FRONT_TRAPEZIUS, FRONT_ADDUCTORS } from './backFront';
import { BACK_TRAPEZIUS, BACK_ADDUCTORS, BACK_UPPER_BACK, BACK_LOWER_BACK } from './backBack';
import { FRONT_DELTOIDS, BACK_DELTOIDS } from './shoulders';
import { FRONT_BICEPS, FRONT_TRICEPS, FRONT_FOREARM } from './armsFront';
import { BACK_TRICEPS, BACK_FOREARM } from './armsBack';
import { FRONT_ABS } from './abs';
import { FRONT_OBLIQUES } from './obliques';

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

export const FRONT_POLYGONS: MusclePolygons = {
  ...FRONT_QUADRICEPS,
  ...FRONT_CALVES,
  ...FRONT_CHEST,
  ...FRONT_TRAPEZIUS,
  ...FRONT_ADDUCTORS,
  ...FRONT_DELTOIDS,
  ...FRONT_BICEPS,
  ...FRONT_TRICEPS,
  ...FRONT_FOREARM,
  ...FRONT_ABS,
  ...FRONT_OBLIQUES,
};

export const BACK_POLYGONS: MusclePolygons = {
  ...BACK_HAMSTRING,
  ...BACK_GLUTEAL,
  ...BACK_CALVES,
  ...BACK_TRAPEZIUS,
  ...BACK_ADDUCTORS,
  ...BACK_UPPER_BACK,
  ...BACK_LOWER_BACK,
  ...BACK_DELTOIDS,
  ...BACK_TRICEPS,
  ...BACK_FOREARM,
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
  tappableSlugs: Set<string>
): string | null {
  const polys = side === 'front' ? FRONT_POLYGONS : BACK_POLYGONS;
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
