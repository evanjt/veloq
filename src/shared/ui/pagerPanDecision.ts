import { BACK_SWIPE_EDGE_WIDTH, startsInBackSwipeEdge } from './backSwipeEdge';

/** Horizontal travel, in points, before the pager decides a pan. */
export const PAGER_ACTIVATION_OFFSET = 10;

export type PagerPanDecision = 'activate' | 'fail' | 'wait';

export interface PagerPanInput {
  /** The page showing when the touch began. */
  index: number;
  tabCount: number;
  /** Where the touch began, in window coordinates. */
  startX: number;
  /** Horizontal travel since the touch began; positive is rightward. */
  translationX: number;
  screenWidth: number;
  isRTL: boolean;
  edgeWidth?: number;
}

/**
 * Whether the tab pager takes a pan. It yields to the system back swipe when
 * the touch starts in the leading-edge strip, and yields any pan toward a page
 * that does not exist, since it has nothing to do with it. Otherwise it takes
 * the pan once it has travelled past the activation offset.
 *
 * Rightward travel shows the previous page whatever the layout direction, as
 * the pager lays its pages out left to right.
 */
export function pagerPanDecision({
  index,
  tabCount,
  startX,
  translationX,
  screenWidth,
  isRTL,
  edgeWidth,
}: PagerPanInput): PagerPanDecision {
  'worklet';
  // A default is read before the body binds the captured names on the UI runtime.
  const edge = edgeWidth ?? BACK_SWIPE_EDGE_WIDTH;
  if (startsInBackSwipeEdge(startX, screenWidth, isRTL, edge)) return 'fail';
  if (Math.abs(translationX) <= PAGER_ACTIVATION_OFFSET) return 'wait';
  if (translationX > 0 && index <= 0) return 'fail';
  if (translationX < 0 && index >= tabCount - 1) return 'fail';
  return 'activate';
}
