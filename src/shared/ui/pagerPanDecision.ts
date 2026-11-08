import { BACK_SWIPE_EDGE_WIDTH, startsInBackSwipeEdge } from './backSwipeEdge';

/** Horizontal travel, in points, before the pager decides a pan. */
export const PAGER_ACTIVATION_OFFSET = 10;

export type PagerPanDecision = 'activate' | 'fail' | 'wait';

/** Which physical ends of a horizontal scroller its content is resting against. */
export interface PagerScrollerEdges {
  atLeft: boolean;
  atRight: boolean;
}

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
  /**
   * The scroller the touch began on, when it began on one. Its pan scrolls it
   * until it rests against the end the pan travels toward.
   */
  scroller?: PagerScrollerEdges | undefined;
}

/**
 * Whether the tab pager takes a pan. It yields to the system back swipe when
 * the touch starts in the leading-edge strip, and yields any pan toward a page
 * that does not exist, since it has nothing to do with it. Otherwise it takes
 * the pan once it has travelled past the activation offset.
 *
 * A touch that began on a horizontal scroller belongs to the scroller until it
 * cannot move further in the direction of travel, and then pages.
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
  scroller,
}: PagerPanInput): PagerPanDecision {
  'worklet';
  // A default is read before the body binds the captured names on the UI runtime.
  const edge = edgeWidth ?? BACK_SWIPE_EDGE_WIDTH;
  if (startsInBackSwipeEdge(startX, screenWidth, isRTL, edge)) return 'fail';
  if (Math.abs(translationX) <= PAGER_ACTIVATION_OFFSET) return 'wait';
  if (translationX > 0 && index <= 0) return 'fail';
  if (translationX < 0 && index >= tabCount - 1) return 'fail';
  if (scroller) {
    const restsAtEnd = translationX > 0 ? scroller.atLeft : scroller.atRight;
    if (!restsAtEnd) return 'wait';
  }
  return 'activate';
}
