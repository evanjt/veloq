/**
 * Which page of a tab pager a scroller sits on, so a pager inside a form sheet hands the sheet's
 * drags to the page on show.
 *
 * Android's form sheet hands a drag to its content only through the first view, depth first, that
 * scrolls nested (`SheetScrollView`). A pager lays its pages side by side in one row, so with
 * every page scrolling nested the first page would take the hand-off whichever page is on show,
 * and a drag on any other page would move the sheet. Only the page on show scrolls nested, so a
 * drag on it scrolls it and the sheet takes the drag once the page is at its top edge. iOS ignores
 * the prop, and its sheet does the same with the scroll view under the finger.
 */
import { createContext, useContext } from 'react';

/** Whether the page a component sits on is the one on show, or null outside a pager. */
export const PagerPageContext = createContext<boolean | null>(null);

/**
 * The props a page's vertical scroller spreads: nested scrolling on the page on show, and on any
 * scroller outside a pager, and none on a page beside it.
 */
export function pagerPageScrollProps(onShow: boolean | null): { nestedScrollEnabled: boolean } {
  return { nestedScrollEnabled: onShow ?? true };
}

export function usePagerPageScrollProps(): { nestedScrollEnabled: boolean } {
  return pagerPageScrollProps(useContext(PagerPageContext));
}
