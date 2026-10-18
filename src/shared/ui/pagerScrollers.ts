import { createContext, useContext, useEffect, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';

type ScrollerGesture = ReturnType<typeof Gesture.Native>;

/** Takes a scroller's gesture into the pager's wait list and hands back its removal. */
export type RegisterPagerScroller = (gesture: ScrollerGesture) => () => void;

/** The tab pager a page sits in, or null outside one. */
export const PagerScrollerContext = createContext<RegisterPagerScroller | null>(null);

/**
 * The native gesture of a horizontal scroller on a pager's page, to wrap the
 * scroller in. The pager waits for it to fail, so a pan that starts on the
 * scroller scrolls it and a pan anywhere else still pages. Outside a pager it
 * is a plain native gesture.
 */
export function usePagerScrollerGesture(): ScrollerGesture {
  const register = useContext(PagerScrollerContext);
  // Per instance: a native gesture carries a handler tag the native side mutates on initialise.
  const gesture = useMemo(() => Gesture.Native(), []);
  useEffect(() => register?.(gesture), [register, gesture]);
  return gesture;
}
