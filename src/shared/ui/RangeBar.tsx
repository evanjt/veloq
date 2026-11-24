/**
 * A two-handle bar over a numeric span, for a filter that keeps what lies between
 * two values.
 *
 * The span is cut into a fixed number of steps so a drag, a screen reader step and
 * the clamp between the handles are the integer index moves the trim controls
 * already share. The bar reports every step while a handle moves, so a label can
 * follow it, and the settled range once the handle is let go, which is when a read
 * should run.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { AccessibilityActionEvent, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useTheme } from '@/shared/app';
import { stepTrimBound, type TrimBound } from '@/shared/math/trimRange';
import {
  colors,
  darkColors,
  layers,
  layout,
  smallElementShadow,
  stroke,
  themePalette,
} from '@/theme';
import * as haptics from './haptics';
import { useGestureCallback } from './useGestureCallback';

const HANDLE_SIZE = 28;
const HANDLE_INNER = 22;
const HANDLE_HIT_SLOP = { top: 15, bottom: 15, left: 15, right: 15 };
const TRACK_HEIGHT = 4;
const STEP_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];
/** The span is cut into this many steps. */
const RANGE_BAR_STEPS = 1000;
/** A screen reader or keyboard step moves a bound by this many steps. */
const ACTION_STEP = 20;

interface RangeBarProps {
  testID: string;
  min: number;
  max: number;
  low: number;
  high: number;
  /** A handle moved to a new step. */
  onChange?: (low: number, high: number) => void;
  /** A handle was let go, or a screen reader step landed. */
  onCommit: (low: number, high: number) => void;
  /** A value as the athlete reads it, spoken for each handle. */
  formatValue: (value: number) => string;
  lowLabel: string;
  highLabel: string;
}

const toStep = (value: number, min: number, max: number) =>
  max > min
    ? Math.max(
        0,
        Math.min(RANGE_BAR_STEPS, Math.round(((value - min) / (max - min)) * RANGE_BAR_STEPS))
      )
    : 0;

const toValue = (step: number, min: number, max: number) =>
  step <= 0 ? min : step >= RANGE_BAR_STEPS ? max : min + (step / RANGE_BAR_STEPS) * (max - min);

export function RangeBar({
  testID,
  min,
  max,
  low,
  high,
  onChange,
  onCommit,
  formatValue,
  lowLabel,
  highLabel,
}: RangeBarProps) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const [trackWidth, setTrackWidth] = useState(0);
  const [lastMoved, setLastMoved] = useState<TrimBound>('end');
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);

  const start = draft?.start ?? toStep(low, min, max);
  const end = draft?.end ?? toStep(high, min, max);
  const startFraction = start / RANGE_BAR_STEPS;
  const endFraction = end / RANGE_BAR_STEPS;
  // Two handles never cover each other: a step is at least one handle wide.
  const minGap = trackWidth > 0 ? Math.ceil((RANGE_BAR_STEPS * HANDLE_SIZE) / trackWidth) : 1;

  const startX = useSharedValue(0);
  const endX = useSharedValue(0);
  const liveStep = useSharedValue(0);

  const move = useCallback(
    (nextStart: number, nextEnd: number) => {
      setDraft({ start: nextStart, end: nextEnd });
      onChange?.(toValue(nextStart, min, max), toValue(nextEnd, min, max));
    },
    [min, max, onChange]
  );

  const commit = useCallback(
    (nextStart: number, nextEnd: number) => {
      setDraft(null);
      onCommit(toValue(nextStart, min, max), toValue(nextEnd, min, max));
    },
    [min, max, onCommit]
  );

  const step = useCallback(
    (bound: TrimBound, delta: number) => {
      setLastMoved(bound);
      const next = stepTrimBound(start, end, RANGE_BAR_STEPS, bound, delta, minGap);
      if (next === (bound === 'start' ? start : end)) return;
      commit(bound === 'start' ? next : start, bound === 'end' ? next : end);
      haptics.light();
    },
    [start, end, minGap, commit]
  );

  const onAction = (bound: TrimBound) => (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') step(bound, ACTION_STEP);
    else if (event.nativeEvent.actionName === 'decrement') step(bound, -ACTION_STEP);
  };

  const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const lastMovedOnJS = useGestureCallback(setLastMoved);
  const moveOnJS = useGestureCallback(move);
  const commitOnJS = useGestureCallback(commit);

  const startGesture = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(`${testID}-start-gesture`)
        .onStart(() => {
          startX.set(startFraction * trackWidth);
          liveStep.set(start);
          runOnJS(lastMovedOnJS)('start');
        })
        .onUpdate((e) => {
          const x = Math.max(0, Math.min(startX.get() + e.translationX, trackWidth));
          const target = Math.round((x / trackWidth) * RANGE_BAR_STEPS);
          const next = stepTrimBound(start, end, RANGE_BAR_STEPS, 'start', target - start, minGap);
          if (next !== liveStep.get()) {
            liveStep.set(next);
            runOnJS(moveOnJS)(next, end);
          }
        })
        .onEnd(() => {
          runOnJS(commitOnJS)(liveStep.get(), end);
        })
        .hitSlop(HANDLE_HIT_SLOP),
    [
      testID,
      startFraction,
      trackWidth,
      start,
      end,
      minGap,
      moveOnJS,
      commitOnJS,
      lastMovedOnJS,
      startX,
      liveStep,
    ]
  );

  const endGesture = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(`${testID}-end-gesture`)
        .onStart(() => {
          endX.set(endFraction * trackWidth);
          liveStep.set(end);
          runOnJS(lastMovedOnJS)('end');
        })
        .onUpdate((e) => {
          const x = Math.max(0, Math.min(endX.get() + e.translationX, trackWidth));
          const target = Math.round((x / trackWidth) * RANGE_BAR_STEPS);
          const next = stepTrimBound(start, end, RANGE_BAR_STEPS, 'end', target - end, minGap);
          if (next !== liveStep.get()) {
            liveStep.set(next);
            runOnJS(moveOnJS)(start, next);
          }
        })
        .onEnd(() => {
          runOnJS(commitOnJS)(start, liveStep.get());
        })
        .hitSlop(HANDLE_HIT_SLOP),
    [
      testID,
      endFraction,
      trackWidth,
      start,
      end,
      minGap,
      moveOnJS,
      commitOnJS,
      lastMovedOnJS,
      endX,
      liveStep,
    ]
  );

  const startHandleStyle = useAnimatedStyle(() => ({
    left: startFraction * trackWidth - HANDLE_SIZE / 2,
  }));
  const endHandleStyle = useAnimatedStyle(() => ({
    left: endFraction * trackWidth - HANDLE_SIZE / 2,
  }));

  const handle = (
    bound: TrimBound,
    gesture: ReturnType<typeof Gesture.Pan>,
    animated: React.ComponentProps<typeof Animated.View>['style'],
    label: string,
    value: number
  ) => (
    <GestureDetector gesture={gesture}>
      <Animated.View
        testID={`${testID}-${bound}-handle`}
        style={[styles.handle, animated, lastMoved === bound ? styles.handleOnTop : null]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: formatValue(value) }}
        accessibilityActions={STEP_ACTIONS}
        onAccessibilityAction={onAction(bound)}
      >
        <View style={[styles.handleInner, { borderColor: palette.actionPrimary }]}>
          <View style={[styles.handleBar, { backgroundColor: palette.actionPrimary }]} />
        </View>
      </Animated.View>
    </GestureDetector>
  );

  return (
    <View style={styles.container} onLayout={onTrackLayout} testID={testID}>
      <View
        style={[styles.trackBg, { backgroundColor: isDark ? darkColors.track : colors.track }]}
      />
      {trackWidth > 0 ? (
        <View
          style={[
            styles.trackActive,
            {
              left: startFraction * trackWidth,
              width: (endFraction - startFraction) * trackWidth,
              backgroundColor: palette.actionPrimary,
            },
          ]}
        />
      ) : null}
      {trackWidth > 0
        ? handle('start', startGesture, startHandleStyle, lowLabel, toValue(start, min, max))
        : null}
      {trackWidth > 0
        ? handle('end', endGesture, endHandleStyle, highLabel, toValue(end, min, max))
        : null}
    </View>
  );
}

// The handle last dragged draws over the other where the two meet.
const HANDLE_ON_TOP = layers.raised + 1;

const styles = StyleSheet.create({
  container: {
    height: HANDLE_SIZE,
    justifyContent: 'center',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    borderRadius: layout.borderRadiusFull,
  },
  trackActive: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: layout.borderRadiusFull,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: layers.raised,
  },
  handleOnTop: {
    zIndex: HANDLE_ON_TOP,
  },
  handleInner: {
    width: HANDLE_INNER,
    height: HANDLE_INNER,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.textOnFill,
    borderWidth: stroke.two,
    justifyContent: 'center',
    alignItems: 'center',
    ...smallElementShadow(),
  },
  handleBar: {
    width: 8,
    height: 2,
    borderRadius: layout.borderRadiusFull,
  },
});
