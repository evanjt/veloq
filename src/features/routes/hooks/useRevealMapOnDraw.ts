import { useEffect, type RefObject } from 'react';
import type { ScrollView } from 'react-native';

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
