import { stroke } from '@/theme';

import type { XY } from './svgPath';

/**
 * The widths every chart stroke is drawn at. A series line is 2px with round
 * joins and caps, its casing one step wider so half a pixel shows each side, a
 * reference rule 1px dashed, the grid 1px dotted and the axis baseline 1px
 * solid. A dot's surface ring and a mark's ring are 2px.
 */
export const chartStroke = {
  series: stroke.two,
  casing: stroke.three,
  reference: stroke.one,
  grid: stroke.one,
  axis: stroke.one,
  ring: stroke.two,
} as const;

/** The dash of a reference rule, such as an average or a threshold. */
export const REFERENCE_DASH = [6, 4];
/** The dot pattern of a gridline. */
export const GRID_DASH = [1, 3];

/** Every chart line joins and ends round, so a sharp turn never spikes past its point. */
export const LINE_JOIN = 'round' as const;
export const LINE_CAP = 'round' as const;

/** A dot is 8px across, set off from the line under it by a 2px ring in the surface colour. */
export const DOT_RADIUS = 4;
export const DOT_RING = chartStroke.ring;

/** The two discs a dot is drawn as, the surface ring under the fill. */
export function dotDisks(): { ring: number; fill: number } {
  return { ring: DOT_RADIUS + DOT_RING, fill: DOT_RADIUS };
}

/** A bar is never wider than this, however sparse the series. */
export const BAR_MAX_WIDTH = 24;
/** The surface gap left between neighbouring bars. */
export const BAR_GAP = stroke.two;
/** The radius of a bar's rounded ends. */
export const BAR_RADIUS = 4;
const BAR_MIN_WIDTH = stroke.one;

/**
 * The width of every bar in a series, cut from the narrowest gap between
 * neighbouring centres less the surface gap, and capped so a sparse series
 * draws bars rather than blocks.
 */
export function barWidthFor(centres: readonly number[], span: number): number {
  let gap = span;
  centres.forEach((x, i) => {
    const previous = centres[i - 1];
    if (previous !== undefined) gap = Math.min(gap, Math.abs(x - previous));
  });
  return Math.max(BAR_MIN_WIDTH, Math.min(BAR_MAX_WIDTH, gap - BAR_GAP));
}

/**
 * The width of each bar in a group of `count` sharing one slot, such as a
 * week's series side by side: the slot less the gap to the next slot, shared
 * with a gap between neighbours, and capped as a single bar is.
 */
export function groupedBarWidth(slot: number, count: number): number {
  const n = Math.max(count, 1);
  const share = (slot - BAR_GAP - (n - 1) * BAR_GAP) / n;
  return Math.max(BAR_MIN_WIDTH, Math.min(BAR_MAX_WIDTH, share));
}

/** The centre of bar `index` in a group of `count` bars of `width`, centred on `centre`. */
export function groupedBarCentre(
  centre: number,
  width: number,
  count: number,
  index: number
): number {
  const total = count * width + (count - 1) * BAR_GAP;
  return centre - total / 2 + width / 2 + index * (width + BAR_GAP);
}

/** A bar's end radius, which a bar too narrow for the full radius halves its width to. */
export function barRadiusFor(width: number): number {
  return Math.max(0, Math.min(BAR_RADIUS, width / 2));
}

/** The record ring's radius, its 2px stroke sitting just outside a dot's surface ring. */
export const RECORD_RING_RADIUS = DOT_RADIUS + DOT_RING + chartStroke.ring / 2;

/** Where the reticle's ticks start and how long each is, clear of a record ring. */
export const RETICLE_INNER = RECORD_RING_RADIUS + chartStroke.ring + 1;
export const RETICLE_TICK = 4;

/** The four ticks of the reticle, above, right, below and left of the point. */
export function reticleTicks(at: XY): { from: XY; to: XY }[] {
  const outer = RETICLE_INNER + RETICLE_TICK;
  return [
    { from: { x: at.x, y: at.y - RETICLE_INNER }, to: { x: at.x, y: at.y - outer } },
    { from: { x: at.x + RETICLE_INNER, y: at.y }, to: { x: at.x + outer, y: at.y } },
    { from: { x: at.x, y: at.y + RETICLE_INNER }, to: { x: at.x, y: at.y + outer } },
    { from: { x: at.x - RETICLE_INNER, y: at.y }, to: { x: at.x - outer, y: at.y } },
  ];
}

/**
 * The record's progression as a staircase: each record holds level until the
 * next one beats it, then steps to it. With `rightEdge`, the newest record is
 * carried flat to that x.
 */
export function staircasePoints(steps: readonly XY[], rightEdge?: number): XY[] {
  const out: XY[] = [];
  steps.forEach((step, i) => {
    const previous = steps[i - 1];
    if (previous !== undefined) out.push({ x: step.x, y: previous.y });
    out.push(step);
  });
  const last = steps.at(-1);
  if (last !== undefined && rightEdge !== undefined && rightEdge > last.x) {
    out.push({ x: rightEdge, y: last.y });
  }
  return out;
}

/** The eFTP mark: an 8px triangle standing on its base, centred on the point. */
export const TRIANGLE_SIZE = 2 * DOT_RADIUS;

export function triangleSvg(at: XY): string {
  const half = TRIANGLE_SIZE / 2;
  return `M${at.x} ${at.y - half}L${at.x + half} ${at.y + half}L${at.x - half} ${at.y + half}Z`;
}
