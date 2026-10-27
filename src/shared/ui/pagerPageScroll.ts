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
 *
 * The cards of a map sheet are the same case: each stays mounted under the one on show, ahead of
 * it in the tree, so only the card on show scrolls nested.
 *
 * The sheet looks for that view again as each touch starts, since a page or card change lays out
 * the content and never the sheet (`scripts/patch-screens-sheet-scroll.js`).
 */
import { createContext, useContext } from 'react';

/** Whether the page a component sits on is the one on show, or null outside a pager. */
export const PagerPageContext = createContext<boolean | null>(null);

/** Whether the map sheet card a component sits in is the one on show. True outside a sheet. */
export const SheetCardShownContext = createContext<boolean>(true);

/**
 * The props a page's vertical scroller spreads: nested scrolling on the page on show, and on any
 * scroller outside a pager, and none on a page beside it or in a sheet card it is covered by.
 */
export function pagerPageScrollProps(
  onShow: boolean | null,
  cardShown = true
): { nestedScrollEnabled: boolean } {
  return { nestedScrollEnabled: (onShow ?? true) && cardShown };
}

export function usePagerPageScrollProps(): { nestedScrollEnabled: boolean } {
  return pagerPageScrollProps(useContext(PagerPageContext), useContext(SheetCardShownContext));
}
