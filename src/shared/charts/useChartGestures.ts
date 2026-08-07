/**
 * Shared scrub gesture for every chart.
 *
 * Uses manual activation rather than `.activateAfterLongPress()`. While the
 * long-press timer runs the gesture stays UNDETERMINED, so a parent ScrollView
 * keeps scrolling and only claims the touch once the finger has actually moved
 * vertically. A JS timer drives the wait so the haptic and the crosshair still
 * fire when the finger is perfectly still, which a worklet-only timer cannot do.
 *
 * Charts feed pixel x-coordinates in through `syncXCoords`. Selection snaps to
 * the nearest of those, which makes log-scaled axes work without a separate
 * domain mode, and the crosshair sits exactly on the point rather than under
 * the finger.
 *
 * Small charts that fill a tappable card use `scrubActivation: 'drag'` instead.
 * There the surface behind answers the tap, so waiting would only delay the
 * scrub, and the tap is composed exclusively against the pan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewStyle } from 'react-native';
import { Gesture, ComposedGesture, GestureType } from 'react-native-gesture-handler';
import {
  useSharedValue,
  useAnimatedReaction,
  useDerivedValue,
  useAnimatedStyle,
  runOnJS,
  SharedValue,
  DerivedValue,
  AnimatedStyle,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { CHART_CONFIG } from './constants';

// ============================================================================
// Types
// ============================================================================

/** Convenience shape for cartesian chart data. The hook itself only indexes. */
export interface ChartPoint {
  x: number;
  [key: string]: unknown;
}

export interface ChartBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What `GestureDetector` accepts, whether or not a tap was composed in. */
export type ChartGesture = GestureType | ComposedGesture;

export interface ChartGestureOptions<T> {
  /** Chart data points, index-aligned with the coords given to `syncXCoords`. */
  data: T[];

  /** Called when a point is selected, by scrub or by tap. */
  onSelect?: (point: T, index: number) => void;

  /** Called when scrubbing starts and ends. */
  onInteractionChange?: (isActive: boolean) => void;

  /** Disable every gesture. A passthrough native gesture is still returned. */
  enabled?: boolean;

  /** Keep the tap but drop the scrub, for compact renderings. */
  scrubEnabled?: boolean;

  /**
   * How the scrub claims the touch. `longPress` waits, which is what a chart
   * inside a scrolling page needs. `drag` claims as soon as the finger moves,
   * for a small chart whose whole card is also tappable.
   */
  scrubActivation?: 'longPress' | 'drag';

  /** Long-press wait before the scrub claims the touch. */
  activationDelay?: number;

  /** Vertical travel that hands the touch back to the scroll parent. */
  verticalSlop?: number;

  /** Movement that starts a drag-activated scrub. */
  dragSlop?: number;

  /** Fire a light impact when the scrub activates. */
  haptics?: boolean;

  /** Cross-chart sync target. Written only while this chart is scrubbing. */
  sharedSelectedIdx?: SharedValue<number>;

  /** Selection driven from outside, shown when nothing else is selected. */
  externalSelectedIdx?: SharedValue<number>;

  /**
   * Resolve a tap at chart-local pixels to a data index, or -1 for none.
   * Supplying this composes a tap gesture in. Charts whose points spread over
   * both axes use it to match on 2D distance instead of x alone.
   */
  resolveTapIndex?: (x: number, y: number) => number;

  /**
   * Tap that does something other than select a point, typically opening the
   * screen behind the chart. Mutually exclusive with `resolveTapIndex`.
   */
  onTap?: () => void;

  /** Longest touch still counted as a tap. */
  tapMaxDuration?: number;
}

export interface ChartGestureResult<T> {
  /** Attach to a `GestureDetector`. */
  gesture: ChartGesture;

  /** Index under the finger, -1 when idle. */
  selectedIndex: DerivedValue<number>;

  /** Raw touch x, -1 when idle. */
  crosshairX: SharedValue<number>;

  /** Whether the user is scrubbing right now. */
  isActive: boolean;

  /** Selected data point, null when nothing is selected. */
  selectedPoint: T | null;

  /** Animated style for the crosshair overlay. */
  crosshairStyle: AnimatedStyle<ViewStyle>;

  /** Feed the plot area rectangle in from the render callback. */
  syncBounds: (bounds: ChartBounds) => void;

  /** Feed per-point pixel x-coordinates in from the render callback. */
  syncXCoords: (coords: number[]) => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useChartGestures<T>(options: ChartGestureOptions<T>): ChartGestureResult<T> {
  const {
    data,
    onSelect,
    onInteractionChange,
    enabled = true,
    scrubEnabled = true,
    scrubActivation = 'longPress',
    activationDelay = CHART_CONFIG.LONG_PRESS_DURATION,
    verticalSlop = CHART_CONFIG.PAN_THRESHOLD,
    dragSlop = CHART_CONFIG.DRAG_SLOP,
    haptics = true,
    sharedSelectedIdx,
    externalSelectedIdx,
    resolveTapIndex,
    onTap,
    tapMaxDuration = CHART_CONFIG.TAP_MAX_DURATION,
  } = options;

  const [isActive, setIsActive] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<T | null>(null);
  const lastNotifiedIdx = useRef<number | null>(null);
  const isActiveRef = useRef(false);

  const touchX = useSharedValue(-1);
  const boundsShared = useSharedValue<ChartBounds>({ left: 0, right: 1, top: 0, bottom: 1 });
  const xCoordsShared = useSharedValue<number[]>([]);
  const fallbackExternalIdx = useSharedValue(-1);
  const externalIdx = externalSelectedIdx ?? fallbackExternalIdx;

  // Callbacks live in refs so the worklet bridge does not rebuild every render.
  const onSelectRef = useRef(onSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  const resolveTapIndexRef = useRef(resolveTapIndex);
  const onTapRef = useRef(onTap);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onInteractionChangeRef.current = onInteractionChange;
    resolveTapIndexRef.current = resolveTapIndex;
    onTapRef.current = onTap;
  }, [onSelect, onInteractionChange, resolveTapIndex, onTap]);

  const dataRef = useRef(data);
  dataRef.current = data;

  const selectedIndex = useDerivedValue(() => {
    'worklet';
    const len = data.length;
    if (touchX.value < 0 || len === 0) return -1;

    const coords = xCoordsShared.value;
    if (coords.length === len) {
      let closestIdx = 0;
      let closestDiff = Math.abs(coords[0] - touchX.value);
      for (let i = 1; i < len; i++) {
        const diff = Math.abs(coords[i] - touchX.value);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      }
      return closestIdx;
    }

    const bounds = boundsShared.value;
    const plotWidth = bounds.right - bounds.left;
    if (plotWidth <= 0) return -1;
    const ratio = Math.max(0, Math.min(1, (touchX.value - bounds.left) / plotWidth));
    return Math.round(ratio * (len - 1));
  }, [data.length]);

  const applySelection = useCallback((idx: number, force: boolean) => {
    const points = dataRef.current;

    if (idx < 0 || points.length === 0) {
      if (lastNotifiedIdx.current !== null) {
        lastNotifiedIdx.current = null;
        isActiveRef.current = false;
        setSelectedPoint(null);
        setIsActive(false);
        onInteractionChangeRef.current?.(false);
      }
      return;
    }

    if (!force && idx === lastNotifiedIdx.current) return;
    lastNotifiedIdx.current = idx;

    if (!isActiveRef.current) {
      isActiveRef.current = true;
      setIsActive(true);
      onInteractionChangeRef.current?.(true);
    }

    const point = points[idx];
    if (point !== undefined) {
      setSelectedPoint(point);
      onSelectRef.current?.(point, idx);
    }
  }, []);

  const handleScrubIndex = useCallback(
    (idx: number) => applySelection(idx, false),
    [applySelection]
  );

  useAnimatedReaction(
    () => selectedIndex.value,
    (idx) => {
      runOnJS(handleScrubIndex)(idx);
      if (sharedSelectedIdx && idx >= 0) {
        sharedSelectedIdx.value = idx;
      }
    },
    [handleScrubIndex, sharedSelectedIdx]
  );

  // Manual activation: hold the touch UNDETERMINED until the timer fires so the
  // scroll parent stays in control, then activate on the next move.
  const gestureStartY = useSharedValue(0);
  const gestureInitialX = useSharedValue(0);
  const gestureReady = useSharedValue(false);
  const gestureActive = useSharedValue(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const beginLongPress = useCallback(() => {
    clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      touchX.value = gestureInitialX.value;
      gestureReady.value = true;
      if (haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, activationDelay);
  }, [touchX, gestureInitialX, gestureReady, activationDelay, haptics]);

  const cancelLongPress = useCallback(() => {
    clearTimeout(longPressTimer.current);
    gestureReady.value = false;
  }, [gestureReady]);

  useEffect(() => () => clearTimeout(longPressTimer.current), []);

  const longPressPan = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e) => {
          'worklet';
          gestureStartY.value = e.allTouches[0].absoluteY;
          gestureInitialX.value = e.allTouches[0].x;
          gestureReady.value = false;
          gestureActive.value = false;
          runOnJS(beginLongPress)();
        })
        .onTouchesMove((e, mgr) => {
          'worklet';
          if (gestureActive.value) return;
          if (Math.abs(e.allTouches[0].absoluteY - gestureStartY.value) > verticalSlop) {
            runOnJS(cancelLongPress)();
            mgr.fail();
            return;
          }
          if (gestureReady.value) {
            gestureActive.value = true;
            mgr.activate();
          }
        })
        .onTouchesUp((_e, mgr) => {
          'worklet';
          if (gestureActive.value) return;
          runOnJS(cancelLongPress)();
          touchX.value = -1;
          mgr.fail();
        })
        .onStart((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onUpdate((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onEnd(() => {
          'worklet';
          touchX.value = -1;
          gestureActive.value = false;
        }),
    [
      beginLongPress,
      cancelLongPress,
      gestureStartY,
      gestureInitialX,
      gestureReady,
      gestureActive,
      touchX,
      verticalSlop,
    ]
  );

  // Drag activation: the scrub takes the touch as soon as the finger moves past
  // the slop, which lets a stationary touch stay a tap on the surface behind.
  const dragPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-dragSlop, dragSlop])
        .activeOffsetY([-dragSlop, dragSlop])
        .onStart((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onUpdate((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onFinalize(() => {
          'worklet';
          touchX.value = -1;
        }),
    [dragSlop, touchX]
  );

  const panGesture = scrubActivation === 'drag' ? dragPan : longPressPan;

  const handleTap = useCallback(
    (x: number, y: number) => {
      const resolve = resolveTapIndexRef.current;
      if (resolve) {
        const idx = resolve(x, y);
        if (idx >= 0) applySelection(idx, true);
        return;
      }
      onTapRef.current?.();
    },
    [applySelection]
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(tapMaxDuration)
        .onEnd((e) => {
          'worklet';
          runOnJS(handleTap)(e.x, e.y);
        }),
    [handleTap, tapMaxDuration]
  );

  // A native gesture must be per-instance: it carries a handler tag the native
  // side mutates on initialize, so a shared one collides across mounts.
  const nativeGesture = useMemo(() => Gesture.Native(), []);
  const wantsTap = resolveTapIndex !== undefined || onTap !== undefined;

  const gesture = useMemo<ChartGesture>(() => {
    if (!enabled) return nativeGesture;
    if (!scrubEnabled)
      return wantsTap ? Gesture.Simultaneous(nativeGesture, tapGesture) : nativeGesture;
    // Drag activation races the tap, so the two must be exclusive or a scrub
    // would also fire the tap on release.
    if (scrubActivation === 'drag') {
      return wantsTap ? Gesture.Exclusive(panGesture, tapGesture) : panGesture;
    }
    if (wantsTap) {
      return Gesture.Simultaneous(nativeGesture, Gesture.Simultaneous(tapGesture, panGesture));
    }
    return panGesture;
  }, [enabled, scrubEnabled, scrubActivation, wantsTap, nativeGesture, tapGesture, panGesture]);

  // Priority: the finger, then a sibling chart, then whatever the screen set.
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    let idx = selectedIndex.value;
    if (idx < 0 && sharedSelectedIdx) idx = sharedSelectedIdx.value;
    if (idx < 0) idx = externalIdx.value;
    if (idx < 0) return { opacity: 0, transform: [{ translateX: 0 }] };

    const coords = xCoordsShared.value;
    if (coords.length > idx) {
      return { opacity: 1, transform: [{ translateX: coords[idx] }] };
    }

    if (touchX.value < 0) return { opacity: 0, transform: [{ translateX: 0 }] };
    const bounds = boundsShared.value;
    const clamped = Math.max(bounds.left, Math.min(bounds.right, touchX.value));
    return { opacity: 1, transform: [{ translateX: clamped }] };
  }, [sharedSelectedIdx]);

  const syncBounds = useCallback(
    (bounds: ChartBounds) => {
      const current = boundsShared.value;
      if (
        bounds.left !== current.left ||
        bounds.right !== current.right ||
        bounds.top !== current.top ||
        bounds.bottom !== current.bottom
      ) {
        boundsShared.value = bounds;
      }
    },
    [boundsShared]
  );

  // Guard before comparing contents so the render callback allocates nothing
  // on the frames where the layout has not moved.
  const syncXCoords = useCallback(
    (coords: number[]) => {
      const current = xCoordsShared.value;
      if (coords.length !== current.length || coords[0] !== current[0]) {
        xCoordsShared.value = coords;
      }
    },
    [xCoordsShared]
  );

  return {
    gesture,
    selectedIndex,
    crosshairX: touchX,
    isActive,
    selectedPoint,
    crosshairStyle,
    syncBounds,
    syncXCoords,
  };
}

export default useChartGestures;
