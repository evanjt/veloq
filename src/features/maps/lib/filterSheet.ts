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
