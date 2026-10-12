/**
 * Width, in points, of the strip along the leading edge of a pushed screen that
 * belongs to the system back swipe. A content gesture that starts inside it
 * yields, so back works over pagers, maps and charts alike.
 */
export const BACK_SWIPE_EDGE_WIDTH = 20;

/**
 * Whether a touch at `x`, in window coordinates, starts in the back-swipe strip.
 * The leading edge is the left in a left-to-right layout and the right under a
 * right-to-left one.
 */
export function startsInBackSwipeEdge(
  x: number,
  screenWidth: number,
  isRTL: boolean,
  edgeWidth: number = BACK_SWIPE_EDGE_WIDTH
): boolean {
  'worklet';
  return isRTL ? x > screenWidth - edgeWidth : x < edgeWidth;
}
