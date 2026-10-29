import { controlHeight, spacing } from '@/theme';

/**
 * Where the Map tab's filter sheet settles after a drag on its handle. A fast
 * flick decides by its direction; otherwise the drag must travel further than
 * the threshold, up to open and down to close.
 */
const DRAG_THRESHOLD = 24;
const FLING_VELOCITY = 500;

export function filterSheetExpandedAfterDrag(
  expanded: boolean,
  translationY: number,
  velocityY: number
): boolean {
  'worklet';
  if (Math.abs(velocityY) >= FLING_VELOCITY) return velocityY < 0;
  if (translationY < -DRAG_THRESHOLD) return true;
  if (translationY > DRAG_THRESHOLD) return false;
  return expanded;
}

/**
 * The sheet's height while a finger drags it from `startHeight`: it follows the
 * finger and stops at the lowered and raised heights.
 */
export function filterSheetDragHeight(
  startHeight: number,
  translationY: number,
  lowered: number,
  raised: number
): number {
  'worklet';
  return Math.min(raised, Math.max(lowered, startHeight - translationY));
}

/**
 * The height the sheet settles on when the finger lifts, the stop
 * `filterSheetExpandedAfterDrag` picks.
 */
export function filterSheetSettleHeight(
  expanded: boolean,
  translationY: number,
  velocityY: number,
  lowered: number,
  raised: number
): number {
  'worklet';
  return filterSheetExpandedAfterDrag(expanded, translationY, velocityY) ? raised : lowered;
}

/**
 * The sheet's two stops. Lowered it shows `loweredHeight`, the handle and the rows
 * under it; raised it adds the `raisedRows` under those, up to `maxHeight`, past
 * which its filters scroll.
 */
export function filterSheetStops(
  loweredHeight: number,
  raisedRows: number,
  maxHeight: number | undefined
): { lowered: number; raised: number } {
  const bound = maxHeight ?? Infinity;
  return {
    lowered: Math.min(loweredHeight, bound),
    raised: Math.min(loweredHeight + raisedRows, bound),
  };
}

/**
 * Distance from the screen's top edge to the foot of the map's top controls, the
 * style toggle that leads the control column.
 */
export function mapTopControlsBottom(insetTop: number): number {
  return insetTop + spacing.smPlus + controlHeight.button + spacing.sm;
}

/**
 * Tallest the filter sheet may grow on a screen `screenHeight` tall: the space
 * under the top controls, past which its filters scroll. Nothing is bounded
 * before the screen is measured.
 */
export function filterSheetMaxHeight(screenHeight: number, insetTop: number): number | undefined {
  if (screenHeight <= 0) return undefined;
  return Math.max(0, screenHeight - mapTopControlsBottom(insetTop));
}

/**
 * Where a map popup's bottom edge sits. `clearance` is what the host draws over the
 * foot of the map as measured, the filter sheet and the credit on its edge, so
 * the popup clears it at any height the sheet reaches. With nothing reported it
 * still clears the home indicator.
 */
export function popupBottom(clearance: number, insetBottom: number): number {
  return Math.max(clearance, insetBottom) + spacing.sm;
}

/**
 * Tallest a popup may grow on a map `mapHeight` tall with its bottom edge at `floor`: the
 * space under the top controls, past which its body scrolls. Nothing is bounded before the
 * map is measured.
 */
export function popupMaxHeight(
  mapHeight: number,
  floor: number,
  insetTop: number
): number | undefined {
  if (mapHeight <= 0) return undefined;
  return Math.max(0, mapHeight - floor - mapTopControlsBottom(insetTop));
}

/**
 * How far the filter sheet and the credit on its edge reach past the bottom clearance, the cover
 * the bottom pill stack rises over. The sheet's padding already holds the clearance, so only what
 * reaches above it counts. A sheet not laid out yet covers nothing.
 */
export function filterSheetFootCover(
  sheetHeight: number,
  attributionClearance: number,
  clearance: number
): number {
  if (sheetHeight <= 0) return 0;
  return Math.max(0, sheetHeight + attributionClearance - clearance);
}
