/**
 * Shared scrub gesture for every chart.
 *
 * A scrub starts on the first horizontal move, with no hold, and a vertical
 * move leaves the touch to the page. `useScrubPan` decides which.
 *
 * Charts feed pixel x-coordinates in through `syncXCoords`. Selection snaps to
 * the nearest of those, which makes log-scaled axes work without a separate
 * domain mode, and the crosshair sits exactly on the point rather than under
 * the finger.
 *
 * Small charts that fill a tappable card use `scrubActivation: 'drag'` instead,
 * which claims a move in any direction and a smaller slop.
 *
 * A screen reader, a switch or a keyboard makes no drag, so the
 * surface is also one adjustable element that steps the selection by sample.
 * A step pins the point the way a tap does: it opens no scrub, so a screen
 * that locks its scroll while scrubbing stays scrollable, and it fires no
 * haptic, since the point is already spoken.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccessibilityActionEvent,
  AccessibilityActionInfo,
  AccessibilityValue,
  ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Gesture,
  type GestureType,
  type LegacyComposedGesture,
} from 'react-native-gesture-handler';
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
import { light as lightHaptic } from '@/shared/ui/haptics';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';
import { accessibleActions, type AccessibleAction } from '@/shared/ui/accessibleActions';
import { CHART_CONFIG } from './constants';
import { useScrubPan } from './useScrubPan';

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
export type ChartGesture = GestureType | LegacyComposedGesture;

/** Spread on the gesture surface. Empty when the chart has nothing to step. */
export interface ChartAccessibilityProps {
  accessible?: boolean;
  accessibilityRole?: 'adjustable';
  accessibilityLabel?: string;
  accessibilityValue?: AccessibilityValue;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}

/** A page step moves this share of the series, so a year is ten steps end to end. */
const PAGE_FRACTION = 0.1;

export interface ChartGestureOptions<T> {
  /** Chart data points, index-aligned with the coords given to `syncXCoords`. */
  data: T[];

  /**
   * The surface's name, the chart's title as its card heads it. The selected
   * point is the value, so a screen reader reads the name, the role, then the point.
   */
  accessibilityLabel: string;

  /** Called when a point is selected, by scrub or by tap. */
  onSelect?: ((point: T, index: number) => void) | undefined;

  /** Called when scrubbing starts and ends. */
  onInteractionChange?: ((isActive: boolean) => void) | undefined;

  /** Disable every gesture. A passthrough native gesture is still returned. */
  enabled?: boolean | undefined;

  /** Keep the tap but drop the scrub, for compact renderings. */
  scrubEnabled?: boolean | undefined;

  /**
   * How the scrub claims the touch. `horizontal` claims a horizontal move and
   * fails a vertical one, which is what a chart inside a scrolling page needs.
   * `drag` claims any move, for a small chart whose whole card is also tappable.
   */
  scrubActivation?: 'horizontal' | 'drag' | undefined;

  /** Movement that starts a drag-activated scrub. */
  dragSlop?: number | undefined;

  /** Fire a light impact when the scrub activates. */
  haptics?: boolean | undefined;

  /** Cross-chart sync target. Written only while this chart is scrubbing. */
  sharedSelectedIdx?: SharedValue<number> | undefined;

  /** Selection driven from outside, shown when nothing else is selected. */
  externalSelectedIdx?: SharedValue<number> | undefined;

  /**
   * Resolve a tap at chart-local pixels to a data index, or -1 for none.
   * Supplying this composes a tap gesture in. Charts whose points spread over
   * both axes use it to match on 2D distance instead of x alone.
   */
  resolveTapIndex?: ((x: number, y: number) => number) | undefined;

  /**
   * Tap that does something other than select a point, typically opening the
   * screen behind the chart. Mutually exclusive with `resolveTapIndex`.
   */
  onTap?: (() => void) | undefined;

  /** Longest touch still counted as a tap. */
  tapMaxDuration?: number | undefined;

  /**
   * Where the crosshair sits. `point` snaps to the selected point, which reads
   * best when the points are far apart. `finger` tracks the touch, which reads
   * best on a dense curve where snapping looks like lag.
   */
  crosshairMode?: 'point' | 'finger' | undefined;

  /**
   * What a screen reader reads for the selected point: its date or position,
   * then its values with their units.
   */
  describePoint?: ((point: T, index: number) => string) | undefined;

  /**
   * What else the chart offers a screen reader beside its steps, such as
   * opening the screen the series came from.
   */
  actions?: readonly AccessibleAction[] | undefined;
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

  /**
   * The sample a scrub, tap or step selected, -1 for none, which a chart marks
   * with a dot on each line.
   */
  scrubIndex: number;

  /** Animated style for the crosshair overlay. */
  crosshairStyle: AnimatedStyle<ViewStyle>;

  /** Feed the plot area rectangle in from the render callback. */
  syncBounds: (bounds: ChartBounds) => void;

  /**
   * Feed per-point pixel x-coordinates in from the render callback. Takes the
   * renderer's own point array and a selector so the guard runs before the
   * map, which matters on a path that fires every frame.
   */
  syncXCoords: <P>(points: readonly P[], getX: (point: P) => number) => void;

  /** The adjustable role, the chart's name, the selected point's value text and the step actions. */
  accessibilityProps: ChartAccessibilityProps;
}

// ============================================================================
// Hook
// ============================================================================

export function useChartGestures<T>(options: ChartGestureOptions<T>): ChartGestureResult<T> {
  const {
    data,
    accessibilityLabel,
    onSelect,
    onInteractionChange,
    enabled = true,
    scrubEnabled = true,
    scrubActivation = 'horizontal',
    dragSlop = CHART_CONFIG.DRAG_SLOP,
    haptics = true,
    sharedSelectedIdx,
    externalSelectedIdx,
    resolveTapIndex,
    onTap,
    tapMaxDuration = CHART_CONFIG.TAP_MAX_DURATION,
    crosshairMode = 'point',
    describePoint,
    actions,
  } = options;

  const { t } = useTranslation();
  const [isActive, setIsActive] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<T | null>(null);
  const lastNotifiedIdx = useRef<number | null>(null);
  const isActiveRef = useRef(false);
  // The point the adjustable element reads, from any source until a scrub ends.
  const [heldIndex, setHeldIndex] = useState(-1);
  const heldIndexRef = useRef(-1);

  const touchX = useSharedValue(-1);
  const boundsShared = useSharedValue<ChartBounds>({ left: 0, right: 1, top: 0, bottom: 1 });
  const xCoordsShared = useSharedValue<number[]>([]);
  const steppedIdx = useSharedValue(-1);
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

  // The worklet captures the count, never the points: the UI runtime copies a
  // worklet's captures and throws on a point carrying a Date.
  const pointCount = data.length;
  const selectedIndex = useDerivedValue(() => {
    'worklet';
    if (touchX.value < 0 || pointCount === 0) return -1;

    const coords = xCoordsShared.value;
    if (coords.length === pointCount) {
      let closestIdx = 0;
      let closestDiff = Math.abs(coords[0] - touchX.value);
      for (let i = 1; i < pointCount; i++) {
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
    return Math.round(ratio * (pointCount - 1));
  }, [pointCount]);

  // A tap is a one-shot selection, so it never opens or closes an interaction.
  // Only the scrub does, otherwise a tap-only chart would report a scrub that
  // never ends.
  const applySelection = useCallback(
    (idx: number, source: 'scrub' | 'tap' | 'step') => {
      const points = dataRef.current;

      // Only a scrub ends. A tap or a step stays selected until the next one.
      if (idx < 0 || points.length === 0) {
        if (isActiveRef.current) {
          lastNotifiedIdx.current = null;
          heldIndexRef.current = -1;
          setHeldIndex(-1);
          isActiveRef.current = false;
          setSelectedPoint(null);
          setIsActive(false);
          onInteractionChangeRef.current?.(false);
        }
        return;
      }

      // A scrub that lands where a tap or a step left off still opens.
      if (source === 'scrub' && isActiveRef.current && idx === lastNotifiedIdx.current) return;
      lastNotifiedIdx.current = idx;
      heldIndexRef.current = idx;
      setHeldIndex(idx);
      // The finger takes over from a step, so lifting it leaves no stale crosshair.
      if (source !== 'step') steppedIdx.value = -1;

      if (source === 'scrub' && !isActiveRef.current) {
        isActiveRef.current = true;
        setIsActive(true);
        onInteractionChangeRef.current?.(true);
      }

      const point = points[idx];
      if (point !== undefined) {
        setSelectedPoint(point);
        onSelectRef.current?.(point, idx);
      }
    },
    [steppedIdx]
  );

  const handleScrubIndex = useCallback(
    (idx: number) => applySelection(idx, 'scrub'),
    [applySelection]
  );
  const scrubOnJS = useGestureCallback(handleScrubIndex);

  useAnimatedReaction(
    () => selectedIndex.value,
    (idx) => {
      runOnJS(scrubOnJS)(idx);
      if (sharedSelectedIdx && idx >= 0) {
        sharedSelectedIdx.value = idx;
      }
    },
    [scrubOnJS, sharedSelectedIdx]
  );

  const activationHaptic = useCallback(() => {
    if (haptics) lightHaptic();
  }, [haptics]);
  const horizontalPan = useScrubPan(touchX, activationHaptic);

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

  const panGesture = scrubActivation === 'drag' ? dragPan : horizontalPan;

  const handleTap = useCallback(
    (x: number, y: number) => {
      const resolve = resolveTapIndexRef.current;
      if (resolve) {
        const idx = resolve(x, y);
        if (idx >= 0) applySelection(idx, 'tap');
        return;
      }
      onTapRef.current?.();
    },
    [applySelection]
  );
  const tapOnJS = useGestureCallback(handleTap);

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(tapMaxDuration)
        .onEnd((e) => {
          'worklet';
          runOnJS(tapOnJS)(e.x, e.y);
        }),
    [tapOnJS, tapMaxDuration]
  );

  // A native gesture must be per-instance: it carries a handler tag the native
  // side mutates on initialise, so a shared one collides across mounts.
  const nativeGesture = useMemo(() => Gesture.Native(), []);
  const wantsTap = resolveTapIndex !== undefined || onTap !== undefined;

  const gesture = useMemo<ChartGesture>(() => {
    if (!enabled) return nativeGesture;
    if (!scrubEnabled)
      return wantsTap ? Gesture.Simultaneous(nativeGesture, tapGesture) : nativeGesture;
    // The scrub claims a moving touch and the tap a still one, so the two are
    // exclusive or a scrub would also fire the tap on release.
    return wantsTap ? Gesture.Exclusive(panGesture, tapGesture) : panGesture;
  }, [enabled, scrubEnabled, wantsTap, nativeGesture, tapGesture, panGesture]);

  // A step starts from whatever is selected, wherever it was set: a sibling
  // chart's selection is the newest, then this chart's own, then the screen's
  // pin. With nothing selected, forward starts at the first sample and back at
  // the newest.
  const stepBy = useCallback(
    (delta: number) => {
      const len = dataRef.current.length;
      if (len === 0) return;
      const inRange = (idx: number) => (idx >= 0 && idx < len ? idx : -1);
      let from = sharedSelectedIdx ? inRange(sharedSelectedIdx.value) : -1;
      if (from < 0) from = inRange(heldIndexRef.current);
      if (from < 0) from = inRange(externalIdx.value);
      const next =
        from < 0 ? (delta > 0 ? 0 : len - 1) : Math.max(0, Math.min(len - 1, from + delta));
      if (next === from) return;
      steppedIdx.value = next;
      if (sharedSelectedIdx) sharedSelectedIdx.value = next;
      applySelection(next, 'step');
    },
    [applySelection, sharedSelectedIdx, externalIdx, steppedIdx]
  );

  const steppable = enabled && scrubEnabled && data.length > 0;
  const heldPoint = heldIndex >= 0 ? data[heldIndex] : undefined;
  const valueText =
    heldPoint !== undefined && describePoint ? describePoint(heldPoint, heldIndex) : undefined;
  const pageLabels = useMemo(
    () => ({ forward: t('a11y.chartPageForward'), back: t('a11y.chartPageBack') }),
    [t]
  );

  const accessibilityProps = useMemo<ChartAccessibilityProps>(() => {
    const extra = actions ?? [];
    if (!steppable) {
      if (extra.length === 0) return {};
      return { accessible: true, accessibilityLabel, ...accessibleActions(extra) };
    }
    const page = Math.max(1, Math.round(data.length * PAGE_FRACTION));
    const steps: Record<string, number> = {
      increment: 1,
      decrement: -1,
      pageForward: page,
      pageBack: -page,
    };
    return {
      accessible: true,
      accessibilityRole: 'adjustable',
      accessibilityLabel,
      ...(valueText !== undefined ? { accessibilityValue: { text: valueText } } : {}),
      accessibilityActions: [
        { name: 'increment' },
        { name: 'decrement' },
        { name: 'pageForward', label: pageLabels.forward },
        { name: 'pageBack', label: pageLabels.back },
        ...extra.map(({ name, label }) => ({ name, label })),
      ],
      onAccessibilityAction: (event) => {
        const name = event.nativeEvent.actionName;
        const delta = steps[name];
        if (delta !== undefined) stepBy(delta);
        else extra.find((action) => action.name === name)?.run();
      },
    };
  }, [steppable, data.length, accessibilityLabel, valueText, pageLabels, stepBy, actions]);

  // Priority: the finger, then a sibling chart, then a step, then whatever the screen set.
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const bounds = boundsShared.value;

    // While the finger is down these charts track it rather than snapping.
    if (crosshairMode === 'finger' && touchX.value >= 0) {
      const clamped = Math.max(bounds.left, Math.min(bounds.right, touchX.value));
      return { opacity: 1, transform: [{ translateX: clamped }] };
    }

    let idx = selectedIndex.value;
    if (idx < 0 && sharedSelectedIdx) idx = sharedSelectedIdx.value;
    if (idx < 0) idx = steppedIdx.value;
    if (idx < 0) idx = externalIdx.value;
    if (idx < 0) return { opacity: 0, transform: [{ translateX: 0 }] };

    const coords = xCoordsShared.value;
    if (coords.length > idx) {
      return { opacity: 1, transform: [{ translateX: coords[idx] }] };
    }

    if (touchX.value < 0) return { opacity: 0, transform: [{ translateX: 0 }] };
    const clamped = Math.max(bounds.left, Math.min(bounds.right, touchX.value));
    return { opacity: 1, transform: [{ translateX: clamped }] };
  }, [sharedSelectedIdx, crosshairMode]);

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

  // Guard before mapping so the render callback allocates nothing on the frames
  // where the layout has not moved.
  const syncXCoords = useCallback(
    <P>(points: readonly P[], getX: (point: P) => number) => {
      const current = xCoordsShared.value;
      const first = points.at(0);
      const last = points.at(-1);
      // First and last both: a resize moves the far end while leaving the first stop in place.
      const unchanged =
        points.length === current.length &&
        (first === undefined ||
          last === undefined ||
          (getX(first) === current.at(0) && getX(last) === current.at(-1)));
      if (!unchanged) xCoordsShared.value = points.map(getX);
    },
    [xCoordsShared]
  );

  return {
    gesture,
    selectedIndex,
    scrubIndex: heldIndex,
    crosshairX: touchX,
    isActive,
    selectedPoint,
    crosshairStyle,
    syncBounds,
    syncXCoords,
    accessibilityProps,
  };
}

export default useChartGestures;
