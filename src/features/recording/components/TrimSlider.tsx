/**
 * Recording trim slider - dual-handle range slider for trimming GPS recordings.
 * Uses react-native-gesture-handler for reliable pan handling that doesn't
 * conflict with Android's edge-swipe back gesture.
 * Design cues from SectionTrimOverlay: pill container, round handles, hit slop.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, LayoutChangeEvent, AccessibilityActionEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layers,
  layout,
  shadows,
  spacing,
  stroke,
  typography,
  themePalette,
} from '@/theme';
import { formatDuration } from '@/shared/format/format';
import { stepTrimBound, trimMinGap, type TrimBound } from '@/shared/math/trimRange';
import { IconButton } from '@/shared/ui';
import * as haptics from '@/shared/ui/haptics';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';

const HANDLE_SIZE = 28;
const TRACK_HEIGHT = 4;
const STEP_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];
/** A screen reader or keyboard step moves a bound by this share of the recording. */
const ACTION_STEP_FRACTION = 0.01;

interface TrimSliderProps {
  totalDuration: number;
  totalPoints: number;
  onTrimChange: (startIdx: number, endIdx: number) => void;
  /**
   * The handle was let go. Told apart from `onTrimChange` so a consumer whose
   * work is too heavy for a frame, such as re-sending both halves of the
   * track to the map, can wait for the gesture to finish.
   */
  onTrimCommit?: (startIdx: number, endIdx: number) => void;
  startIdx: number;
  endIdx: number;
}

export function TrimSlider({
  totalDuration,
  totalPoints,
  onTrimChange,
  onTrimCommit,
  startIdx,
  endIdx,
}: TrimSliderProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const [trackWidth, setTrackWidth] = useState(0);
  // The handle drawn on top, and so the one that takes a touch both hit areas reach.
  const [lastMoved, setLastMoved] = useState<TrimBound>('end');

  const maxIndex = totalPoints - 1;
  const startFraction = maxIndex > 0 ? startIdx / maxIndex : 0;
  const endFraction = maxIndex > 0 ? endIdx / maxIndex : 1;
  const minGap = useMemo(
    () => trimMinGap(maxIndex, trackWidth, HANDLE_SIZE),
    [maxIndex, trackWidth]
  );
  const actionStep = Math.max(1, Math.round(maxIndex * ACTION_STEP_FRACTION));

  const startTime = totalDuration * startFraction;
  const endTime = totalDuration * endFraction;
  const isTrimmed = startIdx > 0 || endIdx < maxIndex;

  const startX = useSharedValue(0);
  const endX = useSharedValue(0);
  // The index the handle last reached, so the release knows where it landed
  // without waiting for React to catch up.
  const liveIndex = useSharedValue(0);

  const commit = useCallback(
    (start: number, end: number) => {
      onTrimCommit?.(start, end);
    },
    [onTrimCommit]
  );

  const canStep = (bound: TrimBound, delta: number) =>
    stepTrimBound(startIdx, endIdx, maxIndex, bound, delta, minGap) !==
    (bound === 'start' ? startIdx : endIdx);

  const step = useCallback(
    (bound: TrimBound, delta: number) => {
      setLastMoved(bound);
      const next = stepTrimBound(startIdx, endIdx, maxIndex, bound, delta, minGap);
      if (next === (bound === 'start' ? startIdx : endIdx)) return;
      const start = bound === 'start' ? next : startIdx;
      const end = bound === 'end' ? next : endIdx;
      onTrimChange(start, end);
      onTrimCommit?.(start, end);
    },
    [startIdx, endIdx, maxIndex, minGap, onTrimChange, onTrimCommit]
  );

  const nudge = useCallback(
    (bound: TrimBound, delta: number) => {
      step(bound, delta);
      haptics.light();
    },
    [step]
  );

  const onStartAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'increment') step('start', actionStep);
      else if (e.nativeEvent.actionName === 'decrement') step('start', -actionStep);
    },
    [step, actionStep]
  );

  const onEndAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'increment') step('end', actionStep);
      else if (e.nativeEvent.actionName === 'decrement') step('end', -actionStep);
    },
    [step, actionStep]
  );

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const lastMovedOnJS = useGestureCallback(setLastMoved);
  const trimChangeOnJS = useGestureCallback(onTrimChange);
  const commitOnJS = useGestureCallback(commit);

  const startGesture = useMemo(
    () =>
      Gesture.Pan()
        .withTestId('review-trim-start-gesture')
        .onStart(() => {
          startX.value = startFraction * trackWidth;
          liveIndex.value = startIdx;
          runOnJS(lastMovedOnJS)('start');
        })
        .onUpdate((e) => {
          const newX = Math.max(0, Math.min(startX.value + e.translationX, trackWidth));
          const newIndex = Math.round((newX / trackWidth) * maxIndex);
          const next = stepTrimBound(
            startIdx,
            endIdx,
            maxIndex,
            'start',
            newIndex - startIdx,
            minGap
          );
          if (next !== liveIndex.value) {
            liveIndex.value = next;
            runOnJS(trimChangeOnJS)(next, endIdx);
          }
        })
        .onEnd(() => {
          runOnJS(commitOnJS)(liveIndex.value, endIdx);
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [
      startFraction,
      trackWidth,
      maxIndex,
      minGap,
      trimChangeOnJS,
      commitOnJS,
      lastMovedOnJS,
      startIdx,
      endIdx,
      startX,
      liveIndex,
    ]
  );

  const endGesture = useMemo(
    () =>
      Gesture.Pan()
        .withTestId('review-trim-end-gesture')
        .onStart(() => {
          endX.value = endFraction * trackWidth;
          liveIndex.value = endIdx;
          runOnJS(lastMovedOnJS)('end');
        })
        .onUpdate((e) => {
          const newX = Math.max(0, Math.min(endX.value + e.translationX, trackWidth));
          const newIndex = Math.round((newX / trackWidth) * maxIndex);
          const next = stepTrimBound(startIdx, endIdx, maxIndex, 'end', newIndex - endIdx, minGap);
          if (next !== liveIndex.value) {
            liveIndex.value = next;
            runOnJS(trimChangeOnJS)(startIdx, next);
          }
        })
        .onEnd(() => {
          runOnJS(commitOnJS)(startIdx, liveIndex.value);
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [
      endFraction,
      trackWidth,
      maxIndex,
      minGap,
      trimChangeOnJS,
      commitOnJS,
      lastMovedOnJS,
      startIdx,
      endIdx,
      endX,
      liveIndex,
    ]
  );

  const startHandleStyle = useAnimatedStyle(() => ({
    left: startFraction * trackWidth - HANDLE_SIZE / 2,
  }));

  const endHandleStyle = useAnimatedStyle(() => ({
    left: endFraction * trackWidth - HANDLE_SIZE / 2,
  }));

  const pillBg = isDark
    ? colorWithOpacity(darkColors.surfaceElevated, 0.92)
    : colorWithOpacity(colors.surface, 0.95);
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;

  const stepButton = (bound: TrimBound, delta: 1 | -1) => {
    const later = delta > 0;
    const disabled = !canStep(bound, delta);
    return (
      <IconButton
        testID={`review-trim-${bound}-${later ? 'later' : 'earlier'}`}
        variant="secondary"
        accessibilityLabel={
          bound === 'start'
            ? later
              ? t('sections.trimStartLater')
              : t('sections.trimStartEarlier')
            : later
              ? t('sections.trimEndLater')
              : t('sections.trimEndEarlier')
        }
        onPress={() => nudge(bound, delta)}
        disabled={disabled}
      >
        <MaterialCommunityIcons
          name={later ? 'chevron-right' : 'chevron-left'}
          size={iconSize.md}
          color={textPrimary}
        />
      </IconButton>
    );
  };

  return (
    <View style={[styles.pill, { backgroundColor: pillBg }]} testID="review-trim-slider">
      {/* Title + time labels */}
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: textPrimary }]}>
          {t('recording.trimActivity', 'Trim activity')}
        </Text>
        <View style={styles.rangeRow}>
          {isTrimmed ? (
            <MaterialCommunityIcons
              name="content-cut"
              size={iconSize.sm}
              color={textPrimary}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          ) : null}
          <Text
            testID="review-trim-range"
            style={[styles.timeRange, { color: textPrimary }, isTrimmed && styles.timeRangeTrimmed]}
          >
            {formatDuration(startTime)} - {formatDuration(endTime)}
          </Text>
        </View>
      </View>

      {/* Slider track */}
      <View style={styles.sliderContainer} onLayout={onTrackLayout} testID="review-trim-track">
        {/* Background track */}
        <View
          style={[
            styles.trackBg,
            { backgroundColor: isDark ? darkColors.inputTrack : colors.inputTrack },
          ]}
        />

        {/* Active range */}
        {trackWidth > 0 && (
          <View
            style={[
              styles.trackActive,
              {
                left: startFraction * trackWidth,
                width: (endFraction - startFraction) * trackWidth,
                backgroundColor: palette.primary,
              },
            ]}
          />
        )}

        {/* Start handle */}
        {trackWidth > 0 && (
          <GestureDetector gesture={startGesture}>
            <Animated.View
              testID="review-trim-start-handle"
              style={[
                styles.handle,
                startHandleStyle,
                lastMoved === 'start' ? styles.handleOnTop : null,
              ]}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={t('recording.trimStartHandle')}
              accessibilityValue={{ text: formatDuration(startTime) }}
              accessibilityActions={STEP_ACTIONS}
              onAccessibilityAction={onStartAction}
            >
              <View style={[styles.handleInner, { borderColor: palette.primary }]}>
                <View style={[styles.handleBar, { backgroundColor: palette.primary }]} />
              </View>
            </Animated.View>
          </GestureDetector>
        )}

        {/* End handle */}
        {trackWidth > 0 && (
          <GestureDetector gesture={endGesture}>
            <Animated.View
              testID="review-trim-end-handle"
              style={[
                styles.handle,
                endHandleStyle,
                lastMoved === 'end' ? styles.handleOnTop : null,
              ]}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={t('recording.trimEndHandle')}
              accessibilityValue={{ text: formatDuration(endTime) }}
              accessibilityActions={STEP_ACTIONS}
              onAccessibilityAction={onEndAction}
            >
              <View style={[styles.handleInner, { borderColor: palette.primary }]}>
                <View style={[styles.handleBar, { backgroundColor: palette.primary }]} />
              </View>
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      {/* Step buttons: one point per press */}
      <View style={styles.stepRow}>
        <View style={styles.stepGroup}>
          {stepButton('start', -1)}
          {stepButton('start', 1)}
        </View>
        <View style={styles.stepGroup}>
          {stepButton('end', -1)}
          {stepButton('end', 1)}
        </View>
      </View>
    </View>
  );
}

// The handle last dragged draws over the other where the two meet. The layer
// scale has no rung between raised and sticky.
const HANDLE_ON_TOP = layers.raised + 1;

const styles = StyleSheet.create({
  pill: {
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.smPlus,
    ...shadows.elevated,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.bodyCompactBold,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  timeRange: {
    ...typography.captionBold,
    fontVariant: ['tabular-nums'],
  },
  timeRangeTrimmed: {
    fontWeight: '700',
  },
  sliderContainer: {
    height: HANDLE_SIZE + 8,
    justifyContent: 'center',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  trackActive: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
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
    width: 22,
    height: 22,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.textOnDark,
    borderWidth: stroke.two,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.elevated,
  },
  handleBar: {
    width: 8,
    height: 2,
    borderRadius: layout.borderRadiusFull,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  stepGroup: {
    flexDirection: 'row',
    // Wider than two hit slops, so neighbouring targets do not overlap.
    gap: spacing.sm,
  },
});
