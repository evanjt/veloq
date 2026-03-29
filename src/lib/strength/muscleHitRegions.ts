/**
 * Approximate tap target positions for muscle groups on the body diagram.
 *
 * Coordinates are percentages (0-1) of the Body component's rendered size.
 * The Body component renders at width=200*scale, height=400*scale.
 * ViewBox is 724x1448 for front, same dimensions for back.
 *
 * These positions were hand-tuned from the react-native-body-highlighter
 * male body SVG assets to place tap targets over visible muscle regions.
 */

interface HitRegion {
  /** Center X as fraction of rendered width (0=left, 1=right) */
  x: number;
  /** Center Y as fraction of rendered height (0=top, 1=bottom) */
  y: number;
}

type MusclePositions = Record<string, HitRegion>;

/** Front view muscle positions (male body) */
export const FRONT_POSITIONS: MusclePositions = {
  chest: { x: 0.5, y: 0.255 },
  abs: { x: 0.5, y: 0.345 },
  obliques: { x: 0.35, y: 0.33 },
  deltoids: { x: 0.23, y: 0.2 },
  biceps: { x: 0.2, y: 0.3 },
  triceps: { x: 0.8, y: 0.3 },
  forearm: { x: 0.15, y: 0.4 },
  quadriceps: { x: 0.38, y: 0.52 },
  adductors: { x: 0.5, y: 0.5 },
  calves: { x: 0.38, y: 0.72 },
  trapezius: { x: 0.38, y: 0.17 },
};

/** Back view muscle positions (male body) */
export const BACK_POSITIONS: MusclePositions = {
  trapezius: { x: 0.5, y: 0.18 },
  deltoids: { x: 0.23, y: 0.2 },
  'upper-back': { x: 0.5, y: 0.25 },
  'lower-back': { x: 0.5, y: 0.33 },
  triceps: { x: 0.2, y: 0.3 },
  forearm: { x: 0.15, y: 0.4 },
  gluteal: { x: 0.5, y: 0.42 },
  hamstring: { x: 0.4, y: 0.55 },
  calves: { x: 0.4, y: 0.72 },
  adductors: { x: 0.5, y: 0.5 },
};

/** Radius of tap target in dp */
export const TAP_TARGET_RADIUS = 22;
