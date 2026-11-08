import { createContext, useContext, useEffect, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { PagerScrollerEdges } from './pagerPanDecision';

type ScrollerGesture = ReturnType<typeof Gesture.Native>;

/** What the pager reads of a scroller on the UI thread. */
export interface PagerScrollerState {
  /** True from the first touch down on the scroller until the touch ends. */
  touching: SharedValue<boolean>;
  edges: SharedValue<PagerScrollerEdges>;
}

/** Takes a scroller's gesture into the pager's wait list and hands back its removal. */
export type RegisterPagerScroller = (
  gesture: ScrollerGesture,
  state?: PagerScrollerState | undefined
) => () => void;

/** Offset, in points, within which a scroller counts as resting at an end. */
const EDGE_TOLERANCE = 1;

/**
 * The ends a horizontal scroller rests against at an offset. An overscroll
 * bounce is past the end it is at.
 */
export function scrollerEdges(
  offsetX: number,
  viewport: number,
  content: number
): PagerScrollerEdges {
  return {
    atLeft: offsetX <= EDGE_TOLERANCE,
    atRight: offsetX >= content - viewport - EDGE_TOLERANCE,
  };
}

/** The tab pager a page sits in, or null outside one. */
export const PagerScrollerContext = createContext<RegisterPagerScroller | null>(null);

/**
 * The native gesture of a horizontal scroller on a pager's page, to wrap the
 * scroller in. The pager waits for it to fail, so a pan that starts on the
 * scroller scrolls it and a pan anywhere else still pages. With `edges` kept
 * current from the scroller's offset, a pan that starts on the scroller pages
 * once the scroller rests against the end the pan travels toward. Outside a
 * pager it is a plain native gesture.
 */
export function usePagerScrollerGesture(edges?: SharedValue<PagerScrollerEdges>): ScrollerGesture {
  const register = useContext(PagerScrollerContext);
  const touching = useSharedValue(false);
  const fallback = useSharedValue<PagerScrollerEdges>({ atLeft: true, atRight: true });
  const tracked = edges ?? fallback;
  // Per instance: a native gesture carries a handler tag the native side mutates on initialise.
  const gesture = useMemo(
    () =>
      Gesture.Native()
        .onTouchesDown(() => {
          'worklet';
          touching.set(true);
        })
        .onFinalize(() => {
          'worklet';
          touching.set(false);
        }),
    [touching]
  );
  const state = useMemo(
    () => (edges ? { touching, edges: tracked } : undefined),
    [edges, touching, tracked]
  );
  useEffect(() => register?.(gesture, state), [register, gesture, state]);
  return gesture;
}
