/**
 * Approximate tap target positions for muscle groups on the body diagram.
 *
 * Coordinates are percentages (0-1) of the Body component's rendered size.
 * Symmetrical muscles have multiple hit regions (left + right).
 */

interface HitRegion {
  /** Center X as fraction of rendered width (0=left, 1=right) */
  x: number;
  /** Center Y as fraction of rendered height (0=top, 1=bottom) */
  y: number;
}

/** Each muscle can have multiple hit regions (e.g. left + right deltoid) */
type MusclePositions = Record<string, HitRegion[]>;

/** Front view muscle positions (male body) */
export const FRONT_POSITIONS: MusclePositions = {
  chest: [
    { x: 0.42, y: 0.255 },
    { x: 0.58, y: 0.255 },
  ],
  abs: [{ x: 0.5, y: 0.345 }],
  obliques: [
    { x: 0.35, y: 0.33 },
    { x: 0.65, y: 0.33 },
  ],
  deltoids: [
    { x: 0.23, y: 0.2 },
    { x: 0.77, y: 0.2 },
  ],
  biceps: [
    { x: 0.2, y: 0.3 },
    { x: 0.8, y: 0.3 },
  ],
  triceps: [
    { x: 0.17, y: 0.28 },
    { x: 0.83, y: 0.28 },
  ],
  forearm: [
    { x: 0.15, y: 0.4 },
    { x: 0.85, y: 0.4 },
  ],
  quadriceps: [
    { x: 0.38, y: 0.52 },
    { x: 0.62, y: 0.52 },
  ],
  adductors: [
    { x: 0.45, y: 0.5 },
    { x: 0.55, y: 0.5 },
  ],
  calves: [
    { x: 0.38, y: 0.72 },
    { x: 0.62, y: 0.72 },
  ],
  trapezius: [
    { x: 0.38, y: 0.17 },
    { x: 0.62, y: 0.17 },
  ],
};

/** Back view muscle positions (male body) */
export const BACK_POSITIONS: MusclePositions = {
  trapezius: [
    { x: 0.42, y: 0.18 },
    { x: 0.58, y: 0.18 },
  ],
  deltoids: [
    { x: 0.23, y: 0.2 },
    { x: 0.77, y: 0.2 },
  ],
  'upper-back': [
    { x: 0.42, y: 0.25 },
    { x: 0.58, y: 0.25 },
  ],
  'lower-back': [
    { x: 0.45, y: 0.33 },
    { x: 0.55, y: 0.33 },
  ],
  triceps: [
    { x: 0.2, y: 0.3 },
    { x: 0.8, y: 0.3 },
  ],
  forearm: [
    { x: 0.15, y: 0.4 },
    { x: 0.85, y: 0.4 },
  ],
  gluteal: [
    { x: 0.42, y: 0.42 },
    { x: 0.58, y: 0.42 },
  ],
  hamstring: [
    { x: 0.4, y: 0.55 },
    { x: 0.6, y: 0.55 },
  ],
  calves: [
    { x: 0.4, y: 0.72 },
    { x: 0.6, y: 0.72 },
  ],
  adductors: [
    { x: 0.45, y: 0.5 },
    { x: 0.55, y: 0.5 },
  ],
};

/** Radius of tap target in dp */
export const TAP_TARGET_RADIUS = 22;

/** Max distance in dp to snap to a muscle during scrub */
export const SCRUB_THRESHOLD = 40;

/**
 * Find the nearest tappable muscle to a touch point.
 * Checks all hit regions (left + right) for each muscle.
 * Returns the muscle slug or null if nothing is within threshold.
 */
export function findNearestMuscle(
  touchX: number,
  touchY: number,
  layoutWidth: number,
  layoutHeight: number,
  side: 'front' | 'back',
  tappableSlugs: Set<string>
): string | null {
  const positions = side === 'front' ? FRONT_POSITIONS : BACK_POSITIONS;
  let nearest: string | null = null;
  let nearestDist = SCRUB_THRESHOLD;

  for (const [slug, regions] of Object.entries(positions)) {
    if (!tappableSlugs.has(slug)) continue;
    for (const pos of regions) {
      const dx = touchX - pos.x * layoutWidth;
      const dy = touchY - pos.y * layoutHeight;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = slug;
      }
    }
  }

  return nearest;
}
