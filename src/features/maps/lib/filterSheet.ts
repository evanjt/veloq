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
  if (Math.abs(velocityY) >= FLING_VELOCITY) return velocityY < 0;
  if (translationY < -DRAG_THRESHOLD) return true;
  if (translationY > DRAG_THRESHOLD) return false;
  return expanded;
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
