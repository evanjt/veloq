/**
 * Gesture handling for the section scatter chart.
 *
 * Owns the `touchX` SharedValue (the scrub crosshair position), the
 * long-press pan gesture, the tap gesture, and the animated reaction that
 * turns pixel X into the closest data point during scrubbing. Returns the
 * composed gesture to attach to a `GestureDetector` and the animated style
 * to attach to the crosshair overlay.
 *
 * Extracted from SectionScatterChart so the chart component focuses on
 * rendering the Skia surface + Victory chart. The component that consumes
 * this hook still owns the local "selected point" state — this hook just
 * notifies via the `onPointSelected` callback.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ViewStyle } from 'react-native';
import { Gesture, type ComposedGesture } from 'react-native-gesture-handler';
import {
  useSharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  runOnJS,
  type AnimatedStyle,
} from 'react-native-reanimated';

import { CHART_CONFIG } from '@/constants';
import type { PerformanceDataPoint } from '@/types';

/** Padding around the chart surface in pixels. */
interface ChartPadding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A point as rendered on the chart — the base record plus its normalized X. */
type ChartPoint = PerformanceDataPoint & { x: number };

export interface UseScatterGesturesParams {
  /** All points rendered on the chart, shared across forward/reverse. */
  allPoints: ChartPoint[];
  /** Chart width in pixels — the raw surface width the gesture targets. */
  chartWidth: number;
  /** Chart height in pixels (effective, accounting for `mini` mode). */
  chartHeight: number;
  /** Chart padding — subtracted from the tap location to get chart content coords. */
  padding: ChartPadding;
  /** Y-domain minimum (from scatterData). */
  minSpeed: number;
  /** Y-domain maximum (from scatterData). */
  maxSpeed: number;
  /** When true, skip the long-press pan scrub gesture but keep tap. */
  compact?: boolean;
  /** When true, skip all gestures (a passthrough `Native` gesture is still returned). */
  mini?: boolean;
  /**
   * Called when a point is selected (via tap or scrub). Receives the full
   * point record so the consumer can update its own selection state and
   * notify any parent listeners.
   */
  onPointSelected: (point: ChartPoint) => void;
  /**
   * Called with `true` when a scrub gesture starts, and `false` when it ends.
   * Used by the consumer to pause map/chart re-renders during scrub.
   */
  onScrubChange?: (scrubbing: boolean) => void;
}

export interface UseScatterGesturesResult {
  /** Composed gesture to attach to a `<GestureDetector gesture={...}>`. */
  composedGesture: ComposedGesture;
  /** Animated style to attach to the crosshair overlay. */
  crosshairStyle: AnimatedStyle<ViewStyle>;
}

/**
 * Chart gesture hook. See file-level JSDoc for lifecycle notes.
 *
 * The consumer is responsible for rendering the `GestureDetector` and the
 * crosshair `Animated.View`.
 */
export function useScatterGestures({
  allPoints,
  chartWidth,
  chartHeight,
  padding,
  minSpeed,
  maxSpeed,
  compact,
  mini,
  onPointSelected,
  onScrubChange,
}: UseScatterGesturesParams): UseScatterGesturesResult {
  // Shared value for scrub crosshair position
  const touchX = useSharedValue(-1);
  // Not read anywhere — kept because the original component set it, so its
  // removal would be a visible behavior change (one extra re-render per
  // scrub start/end). Preserving until we can verify it is truly unused.
  const [, setIsScrubbing] = useState(false);

  // Ref to debounce "same closest point" notifications from the scrub
  // animated-reaction loop. Reset on gesture end.
  const lastNotifiedIdx = useRef(-1);

  // Map a pixel X position to the closest data point (X-only, for scrubbing)
  const selectPointAtX = useCallback(
    (locationX: number) => {
      if (allPoints.length === 0) return;
      const chartContentW = chartWidth - padding.left - padding.right;
      const tapX = locationX - padding.left;
      const normalizedX = Math.max(0, Math.min(1, tapX / chartContentW));

      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < allPoints.length; i++) {
        const dist = Math.abs(allPoints[i].x - normalizedX);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
      if (closestIdx !== lastNotifiedIdx.current) {
        lastNotifiedIdx.current = closestIdx;
        const closest = allPoints[closestIdx];
        if (closest) onPointSelected(closest);
      }
    },
    [allPoints, chartWidth, padding.left, padding.right, onPointSelected]
  );

  // Map pixel (X, Y) to the closest data point using 2D distance (for taps)
  const selectPointAtXY = useCallback(
    (locationX: number, locationY: number) => {
      if (allPoints.length === 0) return;
      const chartContentW = chartWidth - padding.left - padding.right;
      const chartContentH = chartHeight - padding.top - padding.bottom;
      const normalizedX = Math.max(0, Math.min(1, (locationX - padding.left) / chartContentW));
      const normalizedY = Math.max(0, Math.min(1, (locationY - padding.top) / chartContentH));
      // Y in chart goes top=maxSpeed, bottom=minSpeed → invert to get speed-space
      const speedRange = maxSpeed - minSpeed || 1;

      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < allPoints.length; i++) {
        const dx = allPoints[i].x - normalizedX;
        // Normalize speed to 0-1 range, invert Y (top of chart = high speed)
        const pointNormY = 1 - (allPoints[i].speed - minSpeed) / speedRange;
        const dy = pointNormY - normalizedY;
        const dist = dx * dx + dy * dy;
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
      lastNotifiedIdx.current = closestIdx;
      const closest = allPoints[closestIdx];
      if (closest) onPointSelected(closest);
    },
    [
      allPoints,
      chartWidth,
      chartHeight,
      padding.left,
      padding.right,
      padding.top,
      padding.bottom,
      minSpeed,
      maxSpeed,
      onPointSelected,
    ]
  );

  const onGestureStart = useCallback(() => {
    onScrubChange?.(true);
  }, [onScrubChange]);

  const onGestureEnd = useCallback(() => {
    onScrubChange?.(false);
    lastNotifiedIdx.current = -1;
  }, [onScrubChange]);

  // Pan gesture for scrubbing (long-press to activate)
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(CHART_CONFIG.LONG_PRESS_DURATION)
        .onStart((e) => {
          'worklet';
          touchX.value = e.x;
          runOnJS(onGestureStart)();
          runOnJS(setIsScrubbing)(true);
        })
        .onUpdate((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onEnd(() => {
          'worklet';
          touchX.value = -1;
          runOnJS(onGestureEnd)();
          runOnJS(setIsScrubbing)(false);
        }),
    [touchX, onGestureStart, onGestureEnd]
  );

  // Tap gesture for point selection (uses 2D distance for better outlier targeting)
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(200)
        .onEnd((e) => {
          'worklet';
          runOnJS(selectPointAtXY)(e.x, e.y);
        }),
    [selectPointAtXY]
  );

  // Combined gesture — allows ScrollView to handle scroll momentum
  // In compact mode, skip pan (scrub) gesture entirely; in mini mode, skip all gestures
  // Note: `Gesture.Native()` must be created per-instance — it carries a handlerTag
  // that the native side mutates on initialize(). A shared module-level instance
  // causes handler-tag collisions across mounts.
  const nativeGesture = useMemo(() => Gesture.Native(), []);
  const composedGesture = useMemo(
    () =>
      compact || mini
        ? Gesture.Simultaneous(nativeGesture, tapGesture)
        : Gesture.Simultaneous(nativeGesture, Gesture.Simultaneous(tapGesture, panGesture)),
    [nativeGesture, tapGesture, panGesture, compact, mini]
  );

  // Animated reaction: map touch X to closest data point during scrub
  useAnimatedReaction(
    () => touchX.value,
    (x) => {
      if (x >= 0) {
        runOnJS(selectPointAtX)(x);
      }
    },
    [selectPointAtX]
  );

  // Crosshair style
  const crosshairStyle = useAnimatedStyle(() => {
    if (touchX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }
    return {
      opacity: 1,
      transform: [{ translateX: touchX.value }],
    };
  }, []);

  return { composedGesture, crosshairStyle };
}
