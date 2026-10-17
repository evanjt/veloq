import { spacing } from '@/theme';

/** Room left around a fitted track, in pixels: the 2D activity map and every 3D surface. */
export const TRACK_FIT_PADDING = spacing.xxl;

/** Share of each axis a fit always keeps to draw in, however much of the map is covered. */
const MIN_VISIBLE_SHARE = 1 / 3;

/** Padding for a fit, in pixels, one value per edge. */
export interface MapEdgeInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface VisibleMapInsetInput {
  /** The map's size, in pixels. */
  width: number;
  height: number;
  /** Height covered at the top, such as the header drawn over the map. */
  coveredTop?: number | undefined;
  /** Height covered at the bottom, such as the hero's name and stats or a sheet. */
  coveredBottom?: number | undefined;
  /** Width covered at the right, such as the control column. */
  coveredRight?: number | undefined;
  /** Room left between the fitted geometry and the visible part's edge. */
  margin?: number | undefined;
}

function axisInset(size: number, coverStart: number, coverEnd: number, margin: number) {
  let start = Math.max(0, coverStart) + margin;
  let end = Math.max(0, coverEnd) + margin;
  const limit = Math.max(0, size) * (1 - MIN_VISIBLE_SHARE);
  if (start + end > limit) {
    const scale = start + end > 0 ? limit / (start + end) : 0;
    start *= scale;
    end *= scale;
  }
  return [Math.round(start), Math.round(end)] as const;
}

/**
 * The per-edge padding that fits geometry into the part of a map nothing covers. Each edge is what
 * covers it plus the margin. When the covers and margins on one axis would leave less than a third
 * of it, both sides shrink in proportion, so the fit keeps room to draw and still favours the side
 * that is covered more.
 */
export function visibleMapInset({
  width,
  height,
  coveredTop = 0,
  coveredBottom = 0,
  coveredRight = 0,
  margin = TRACK_FIT_PADDING,
}: VisibleMapInsetInput): MapEdgeInset {
  const [top, bottom] = axisInset(height, coveredTop, coveredBottom, margin);
  const [left, right] = axisInset(width, 0, coveredRight, margin);
  return { top, right, bottom, left };
}
