/**
 * How large the front and back body figures are drawn in the width they are given.
 *
 * The body library draws a figure 200 by 400 at scale 1. A caller names the
 * largest scale it wants, and the pair never draws wider than its share of the
 * row, so a figure never covers the centre column between the two.
 */

/** The body figure's size at scale 1, from the body library's own view box. */
export const BODY_INTRINSIC_W = 200;
export const BODY_INTRINSIC_H = 400;

/** The width of the body library's view box, the units a part's stroke is given in. */
const BODY_VIEW_BOX_W = 724;

/**
 * A stroke width in view box units that draws `width` points wide on a figure at
 * `scale`, so an outline stays the same weight however large the figure is drawn.
 * The loupe draws the same parts larger, so it magnifies the outline with them.
 */
export function viewBoxStroke(width: number, scale: number): number {
  return scale > 0 ? (width * BODY_VIEW_BOX_W) / (BODY_INTRINSIC_W * scale) : width;
}

/**
 * Below this, two figures beside the centre column are too small to tap a
 * muscle on, so the column moves under them and they take the whole row.
 */
const MIN_SIDE_BY_SIDE_SCALE = 0.4;

export interface BodyPairLayout {
  scale: number;
  /** The centre column is drawn under the figures rather than between them. */
  stackCenter: boolean;
}

function fitScale(width: number, gap: number, maxScale: number): number {
  return Math.max(0, Math.min(maxScale, (width - gap) / (2 * BODY_INTRINSIC_W)));
}

export function bodyPairLayout(
  width: number,
  centerWidth: number,
  maxScale: number
): BodyPairLayout {
  const scale = fitScale(width, centerWidth, maxScale);
  if (centerWidth > 0 && scale < Math.min(maxScale, MIN_SIDE_BY_SIDE_SCALE)) {
    return { scale: fitScale(width, 0, maxScale), stackCenter: true };
  }
  return { scale, stackCenter: false };
}
