import { startsInBackSwipeEdge } from '@/shared/ui/backSwipeEdge';

/**
 * Travel, in points, before a chart scrub decides a pan. Below the tab pager's
 * activation offset, so a chart inside the pager takes a horizontal move first.
 */
export const SCRUB_SLOP = 8;

export type ScrubPanDecision = 'activate' | 'fail' | 'wait';

export interface ScrubPanInput {
  /** Where the touch began, in window coordinates. */
  startX: number;
  /** Travel since the touch began. */
  translationX: number;
  translationY: number;
  screenWidth: number;
  isRTL: boolean;
  slop: number;
}

/**
 * Whether a chart scrub takes a pan. A scrub starts on the first horizontal
 * move, with no hold, and fails on a vertical one so the page still scrolls.
 * A touch in the leading-edge strip is left to the system back swipe.
 */
export function scrubPanDecision({
  startX,
  translationX,
  translationY,
  screenWidth,
  isRTL,
  slop,
}: ScrubPanInput): ScrubPanDecision {
  'worklet';
  if (startsInBackSwipeEdge(startX, screenWidth, isRTL)) return 'fail';
  const dx = Math.abs(translationX);
  const dy = Math.abs(translationY);
  if (dx <= slop && dy <= slop) return 'wait';
  return dx > dy ? 'activate' : 'fail';
}
