import { useEffect, type RefObject } from 'react';
import type { ScrollView } from 'react-native';
import type { MapHighlightStore } from '@/features/routes/lib/mapHighlight';

/**
 * Scrolls a page to its top, where the hero map sits, whenever the map is given
 * something new to draw. Clearing the target leaves the page where it is.
 */
export function useRevealMapOnDraw(
  scrollRef: RefObject<Pick<ScrollView, 'scrollTo'> | null>,
  drawTarget: unknown
): void {
  useEffect(() => {
    if (drawTarget == null) return;
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [scrollRef, drawTarget]);
}

/**
 * The same reveal for a target held in a highlight store: the hook listens to
 * the store and never renders, so a scrub index reaches the scroll view
 * without reaching the screen. A new id scrolls, the same id again and a clear
 * do not.
 */
export function useRevealMapOnHighlight(
  scrollRef: RefObject<Pick<ScrollView, 'scrollTo'> | null>,
  store: MapHighlightStore
): void {
  useEffect(() => {
    let shown = store.get().activityId;
    return store.subscribe(() => {
      const next = store.get().activityId;
      if (next === shown) return;
      shown = next;
      if (next == null) return;
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [scrollRef, store]);
}
