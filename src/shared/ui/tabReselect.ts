/**
 * The one owner of a tab reselect: pressing the tab already in front returns its root list to
 * where the tab opens, scrolled to the top, as both platforms train their tab bars to do.
 *
 * The tab bar emits the reselect in place of navigating, and each list on a tab root listens for
 * its own tab with `useScrollToTopOnReselect`. A tab with no list, the map, listens for nothing,
 * so its reselect does nothing.
 */
import { useEffect, useRef, type RefObject } from 'react';

import { isReduceMotionOn } from './reduceMotion';

/** The tab bar's destinations, by the route each one navigates to. */
export type TabRoute = '/' | '/fitness' | '/map' | '/insights' | '/training';

/** A list scrolls by offset, a scroll view by position: either can be sent back. */
type Scrollable =
  | { scrollToOffset(params: { offset: number; animated?: boolean | undefined }): void }
  | { scrollTo(params: { y: number; animated?: boolean }): void };

const listeners = new Map<TabRoute, Set<() => void>>();

/** Tells every list on `tab` that its tab was pressed while in front. */
export function emitTabReselect(tab: TabRoute): void {
  listeners.get(tab)?.forEach((listener) => listener());
}

function subscribe(tab: TabRoute, listener: () => void): () => void {
  let set = listeners.get(tab);
  if (!set) {
    set = new Set();
    listeners.set(tab, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/**
 * Scrolls `ref` back to `offset` when `tab` is reselected. The offset is where the list opens,
 * 0 for most; a function is read at the press, so a measured offset is current.
 */
export function useScrollToTopOnReselect(
  tab: TabRoute,
  ref: RefObject<Scrollable | null>,
  offset: number | (() => number) = 0
): void {
  const offsetRef = useRef(offset);
  useEffect(() => {
    offsetRef.current = offset;
  });

  useEffect(
    () =>
      subscribe(tab, () => {
        const target = ref.current;
        if (!target) return;
        const read = offsetRef.current;
        const y = typeof read === 'function' ? read() : read;
        const animated = !isReduceMotionOn();
        if ('scrollToOffset' in target) target.scrollToOffset({ offset: y, animated });
        else target.scrollTo({ y, animated });
      }),
    [tab, ref]
  );
}
