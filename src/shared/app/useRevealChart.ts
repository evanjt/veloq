/**
 * Open a tab on the chart a link named.
 *
 * The chart arrives as a route param. It is taken once: `prepare` makes it
 * drawable (a section expanded, a sport switched), the param is cleared so a
 * later visit from the tab bar opens at the top, and the scroll view moves to
 * the chart's anchor as soon as that anchor reports a position. Expanding a
 * section or switching a sport moves what sits below it, so the scroll follows
 * the anchor while it settles and lets go the moment the athlete scrolls.
 * A page that pins a header reports it through `onHeaderLayout`, and the chart
 * then lands below the header rather than under it.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';
import { router } from 'expo-router';

import { isReduceMotionOn } from '@/shared/ui/reduceMotion';

export function useRevealChart<Chart extends string, Anchor extends string>(
  chart: Chart | null,
  anchorOf: (chart: Chart) => Anchor,
  prepare?: ((chart: Chart) => void) | undefined
) {
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const anchors = useRef(new Map<Anchor, number>());
  // The anchor being followed. Nothing renders from it, so it is a ref.
  const revealing = useRef<Anchor | null>(null);
  // The height of the page's pinned header, zero on a page without one.
  const pinned = useRef(0);

  const anchorOfRef = useRef(anchorOf);
  const prepareRef = useRef(prepare);
  useEffect(() => {
    anchorOfRef.current = anchorOf;
    prepareRef.current = prepare;
  }, [anchorOf, prepare]);

  const scrollToAnchor = useCallback((anchor: Anchor) => {
    const y = anchors.current.get(anchor);
    if (y === undefined) return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, y - pinned.current),
      animated: !isReduceMotionOn(),
    });
  }, []);

  useEffect(() => {
    if (!chart) return;
    prepareRef.current?.(chart);
    const anchor = anchorOfRef.current(chart);
    revealing.current = anchor;
    scrollToAnchor(anchor);
    router.setParams({ chart: undefined });
  }, [chart, scrollToAnchor]);

  const onAnchorLayout = useCallback(
    (anchor: Anchor, event: LayoutChangeEvent) => {
      anchors.current.set(anchor, event.nativeEvent.layout.y);
      if (revealing.current === anchor) scrollToAnchor(anchor);
    },
    [scrollToAnchor]
  );

  const onHeaderLayout = useCallback(
    (event: LayoutChangeEvent) => {
      pinned.current = event.nativeEvent.layout.height;
      if (revealing.current !== null) scrollToAnchor(revealing.current);
    },
    [scrollToAnchor]
  );

  const onScrollBeginDrag = useCallback(() => {
    revealing.current = null;
  }, []);

  return { scrollRef, onAnchorLayout, onHeaderLayout, onScrollBeginDrag };
}
