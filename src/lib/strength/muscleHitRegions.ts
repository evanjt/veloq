/**
 * Muscle group tap/scrub hit regions.
 *
 * Positions are fractions (0-1) of the Body SVG's intrinsic coordinate space
 * (viewBox 724x1448). The Body renders at 200*scale x 400*scale pixels.
 *
 * Extracted from react-native-body-highlighter SVG path bounding box centers.
 */

interface HitRegion {
  x: number;
  y: number;
}

type MusclePositions = Record<string, HitRegion[]>;

/** Front view — SVG-relative positions */
export const FRONT_POSITIONS: MusclePositions = {
  chest: [
    { x: 0.377, y: 0.292 },
    { x: 0.575, y: 0.3 },
  ],
  abs: [
    { x: 0.457, y: 0.394 },
    { x: 0.544, y: 0.365 },
  ],
  obliques: [
    { x: 0.391, y: 0.377 },
    { x: 0.614, y: 0.38 },
  ],
  deltoids: [
    { x: 0.379, y: 0.215 },
    { x: 0.622, y: 0.222 },
  ],
  biceps: [
    { x: 0.262, y: 0.34 },
    { x: 0.727, y: 0.336 },
  ],
  triceps: [
    { x: 0.285, y: 0.355 },
    { x: 0.715, y: 0.354 },
  ],
  forearm: [
    { x: 0.231, y: 0.418 },
    { x: 0.815, y: 0.472 },
  ],
  quadriceps: [
    { x: 0.413, y: 0.65 },
    { x: 0.593, y: 0.649 },
  ],
  adductors: [
    { x: 0.425, y: 0.534 },
    { x: 0.574, y: 0.497 },
  ],
  calves: [
    { x: 0.392, y: 0.711 },
    { x: 0.6, y: 0.779 },
  ],
  trapezius: [
    { x: 0.394, y: 0.212 },
    { x: 0.572, y: 0.215 },
  ],
};

/** Back view — SVG-relative positions */
export const BACK_POSITIONS: MusclePositions = {
  trapezius: [
    { x: 0.479, y: 0.213 },
    { x: 0.608, y: 0.209 },
  ],
  deltoids: [
    { x: 0.355, y: 0.221 },
    { x: 0.695, y: 0.219 },
  ],
  'upper-back': [
    { x: 0.385, y: 0.333 },
    { x: 0.59, y: 0.282 },
  ],
  'lower-back': [
    { x: 0.388, y: 0.426 },
    { x: 0.548, y: 0.409 },
  ],
  triceps: [
    { x: 0.286, y: 0.327 },
    { x: 0.707, y: 0.331 },
  ],
  forearm: [
    { x: 0.214, y: 0.415 },
    { x: 0.786, y: 0.417 },
  ],
  gluteal: [
    { x: 0.418, y: 0.48 },
    { x: 0.548, y: 0.486 },
  ],
  hamstring: [
    { x: 0.392, y: 0.552 },
    { x: 0.601, y: 0.583 },
  ],
  calves: [
    { x: 0.379, y: 0.799 },
    { x: 0.601, y: 0.798 },
  ],
  adductors: [
    { x: 0.478, y: 0.542 },
    { x: 0.557, y: 0.544 },
  ],
};

/** Radius of tap target in dp */
export const TAP_TARGET_RADIUS = 22;

/** Max distance in dp to snap to a muscle during scrub */
export const SCRUB_THRESHOLD = 40;

/** Body SVG intrinsic dimensions */
const BODY_INTRINSIC_W = 200;
const BODY_INTRINSIC_H = 400;

/**
 * Find the nearest tappable muscle to a touch point.
 *
 * Touch coordinates are in container space (relative to the flex:1 body container).
 * Hit region positions are in SVG-relative space (0-1 of the SVG's intrinsic size).
 * We convert touch to SVG-local space before comparing.
 *
 * @param touchX - Touch X relative to the body's flex container
 * @param touchY - Touch Y relative to the row
 * @param containerW - Width of the body's flex container
 * @param containerH - Height of the row
 * @param scale - Body scale prop
 */
export function findNearestMuscle(
  touchX: number,
  touchY: number,
  containerW: number,
  containerH: number,
  side: 'front' | 'back',
  tappableSlugs: Set<string>,
  scale: number = 0.6
): string | null {
  const positions = side === 'front' ? FRONT_POSITIONS : BACK_POSITIONS;

  // SVG pixel dimensions
  const svgW = BODY_INTRINSIC_W * scale;
  const svgH = BODY_INTRINSIC_H * scale;

  // Centering offset (SVG is centered in the flex container)
  const padX = (containerW - svgW) / 2;

  // Convert touch to SVG-local space
  const svgTouchX = touchX - padX;
  const svgTouchY = touchY; // No vertical padding (alignItems: flex-start)

  let nearest: string | null = null;
  let nearestDist = SCRUB_THRESHOLD;

  for (const [slug, regions] of Object.entries(positions)) {
    if (!tappableSlugs.has(slug)) continue;
    for (const pos of regions) {
      // Position in SVG pixel space
      const posPixelX = pos.x * svgW;
      const posPixelY = pos.y * svgH;

      const dx = svgTouchX - posPixelX;
      const dy = svgTouchY - posPixelY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = slug;
      }
    }
  }

  return nearest;
}
