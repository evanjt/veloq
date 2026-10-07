import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  LayoutChangeEvent,
  Platform,
  AccessibilityActionEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { colors, darkColors, typography, spacing, layout, smallElementShadow } from '@/theme';
import { createTimelineLayout, addCalendarMonths } from '@/features/maps/lib/timelineLayout';
import { formatMonth, getIntlLocale } from '@/shared/format/format';

interface TimelineSliderProps {
  /** Minimum date (oldest activity) */
  minDate: Date;
  /** Maximum date (today) */
  maxDate: Date;
  /** Currently selected start date */
  startDate: Date;
  /** Currently selected end date */
  endDate: Date;
  /** Callback when range changes */
  onRangeChange: (start: Date, end: Date) => void;
  /** Whether we're currently loading data */
  isLoading?: boolean;
  /** Activity count in selected range */
  activityCount?: number;
  /** Dark mode */
  isDark?: boolean;
  /** Fix end handle at "now" - cannot be dragged (default: false) */
  fixedEnd?: boolean;
  /** Only allow start handle to move left (expand range, never contract) (default: false) */
  expandOnly?: boolean;
  /**
   * startDate and endDate are the committed range. A host that declines a change from
   * onRangeChange bumps this to put both handles back on that range, since the dates alone
   * are unchanged and would not move them.
   */
  resetKey?: number;
}

// Larger touch area for handles
const HANDLE_SIZE = 28;
const HANDLE_HIT_SLOP = Platform.select({ ios: 30, default: 20 });
const MIN_RANGE = 0.02;
const STEP_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];

export function TimelineSlider({
  minDate,
  maxDate,
  startDate,
  endDate,
  onRangeChange,
  isLoading,
  activityCount,
  isDark = false,
  fixedEnd = false,
  expandOnly = false,
  resetKey,
}: TimelineSliderProps) {
  const { t } = useTranslation();
  const [trackWidth, setTrackWidth] = useState(0);

  const { dateToPosition, positionToDate, snapPoints, snapToNearest } = useMemo(
    () => createTimelineLayout({ minDate, maxDate, trackWidth }),
    [minDate, maxDate, trackWidth]
  );

  // Shared values for animation
  const startPos = useSharedValue(dateToPosition(startDate));
  const endPos = useSharedValue(dateToPosition(endDate));
  const startPosAtGestureStart = useSharedValue(0);
  const endPosAtGestureStart = useSharedValue(0);

  // Sync shared values when props change
  useEffect(() => {
    startPos.value = dateToPosition(startDate);
    endPos.value = dateToPosition(endDate);
  }, [startDate, endDate, dateToPosition, startPos, endPos, resetKey]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const tickLabels = useMemo(
    () =>
      snapPoints.map((point) => {
        if (point.kind === 'year') return `'${point.date.getFullYear().toString().slice(-2)}`;
        if (point.kind === 'quarter') return formatMonth(point.date);
        return t('time.now');
      }),
    [snapPoints, t]
  );

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const updateDatesFromPositions = useCallback(
    (startPosValue: number, endPosValue: number) => {
      const start = positionToDate(startPosValue);
      const end = positionToDate(endPosValue);
      onRangeChange(start, end);
    },
    [positionToDate, onRangeChange]
  );

  const applySnapAndUpdate = useCallback(
    (startPosValue: number, endPosValue: number, startLimit?: number) => {
      const startResult = snapToNearest(startPosValue, startLimit);
      const endResult = snapToNearest(endPosValue);
      startPos.value = startResult.position;
      endPos.value = endResult.position;

      if (startResult.snapped || endResult.snapped) {
        triggerHaptic();
      }

      updateDatesFromPositions(startResult.position, endResult.position);
    },
    [snapToNearest, updateDatesFromPositions, triggerHaptic, startPos, endPos]
  );

  // Handle tap on track to move left handle
  const handleTrackTap = useCallback(
    (tapX: number) => {
      if (trackWidth === 0) return;

      const tapPosition = Math.max(0, Math.min(1, tapX / trackWidth));
      const snappedResult = snapToNearest(tapPosition);
      const targetPos = snappedResult.position;

      // In expandOnly mode, only allow tapping to positions left of current start
      if (expandOnly && targetPos >= startPos.value) {
        return;
      }

      if (targetPos >= endPos.value) {
        // Don't move past end position
        return;
      } else {
        startPos.value = targetPos;
        triggerHaptic();
        updateDatesFromPositions(targetPos, endPos.value);
      }
    },
    [
      trackWidth,
      snapToNearest,
      triggerHaptic,
      updateDatesFromPositions,
      expandOnly,
      startPos,
      endPos,
    ]
  );

  const stepStart = useCallback(
    (direction: 1 | -1) => {
      let target = addCalendarMonths(startDate, direction);
      if (target < minDate) target = minDate;
      if (expandOnly && target >= startDate) return;
      if (target.getTime() === startDate.getTime() || target >= endDate) return;
      startPos.value = dateToPosition(target);
      triggerHaptic();
      onRangeChange(target, endDate);
    },
    [
      startDate,
      endDate,
      minDate,
      expandOnly,
      dateToPosition,
      startPos,
      triggerHaptic,
      onRangeChange,
    ]
  );

  const stepEnd = useCallback(
    (direction: 1 | -1) => {
      let target = addCalendarMonths(endDate, direction);
      if (target > maxDate) target = maxDate;
      if (target.getTime() === endDate.getTime() || target <= startDate) return;
      endPos.value = dateToPosition(target);
      triggerHaptic();
      onRangeChange(startDate, target);
    },
    [startDate, endDate, maxDate, dateToPosition, endPos, triggerHaptic, onRangeChange]
  );

  const onStartAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'increment') stepStart(1);
      else if (e.nativeEvent.actionName === 'decrement') stepStart(-1);
    },
    [stepStart]
  );

  const onEndAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'increment') stepEnd(1);
      else if (e.nativeEvent.actionName === 'decrement') stepEnd(-1);
    },
    [stepEnd]
  );

  const formatHandleDate = (date: Date) =>
    date.toLocaleDateString(getIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' });

  // Gestures
  const trackTapGesture = Gesture.Tap().onEnd((e) => {
    runOnJS(handleTrackTap)(e.x);
  });

  const startGesture = Gesture.Pan()
    .hitSlop({
      top: HANDLE_HIT_SLOP,
      bottom: HANDLE_HIT_SLOP,
      left: HANDLE_HIT_SLOP,
      right: HANDLE_HIT_SLOP,
    })
    .onBegin(() => {
      startPosAtGestureStart.value = startPos.value;
    })
    .onUpdate((e) => {
      if (trackWidth === 0) return;
      const delta = e.translationX / trackWidth;
      let newPos = startPosAtGestureStart.value + delta;

      // In expandOnly mode, only allow moving left (lower position values)
      if (expandOnly) {
        newPos = Math.min(newPos, startPosAtGestureStart.value);
      }

      newPos = Math.max(0, Math.min(endPos.value - MIN_RANGE, newPos));
      startPos.value = newPos;
    })
    .onEnd(() => {
      runOnJS(applySnapAndUpdate)(
        startPos.value,
        endPos.value,
        expandOnly ? startPosAtGestureStart.value : undefined
      );
    });

  const endGesture = Gesture.Pan()
    .hitSlop({
      top: HANDLE_HIT_SLOP,
      bottom: HANDLE_HIT_SLOP,
      left: HANDLE_HIT_SLOP,
      right: HANDLE_HIT_SLOP,
    })
    .onBegin(() => {
      endPosAtGestureStart.value = endPos.value;
    })
    .onUpdate((e) => {
      if (trackWidth === 0) return;
      const delta = e.translationX / trackWidth;
      const newPos = Math.max(
        startPos.value + MIN_RANGE,
        Math.min(1, endPosAtGestureStart.value + delta)
      );
      endPos.value = newPos;
    })
    .onEnd(() => {
      runOnJS(applySnapAndUpdate)(startPos.value, endPos.value);
    });

  // Animated styles
  const startHandleStyle = useAnimatedStyle(() => ({
    left: startPos.value * trackWidth - HANDLE_SIZE / 2,
  }));

  const endHandleStyle = useAnimatedStyle(() => ({
    left: endPos.value * trackWidth - HANDLE_SIZE / 2,
  }));

  const rangeStyle = useAnimatedStyle(() => ({
    left: startPos.value * trackWidth,
    right: trackWidth - endPos.value * trackWidth,
  }));

  return (
    <View style={styles.wrapper} testID="timeline-slider">
      <View style={[styles.container, isDark && styles.containerDark]}>
        {/* Slider track */}
        <GestureDetector gesture={trackTapGesture}>
          <View style={styles.sliderContainer} onLayout={onLayout} testID="timeline-slider-track">
            <View style={[styles.track, isDark && styles.trackDark]} />

            <Animated.View style={[styles.selectedRange, rangeStyle]} />

            {/* Start handle - bracket style [ for expandable */}
            <GestureDetector gesture={startGesture}>
              <Animated.View
                style={[styles.handleContainer, startHandleStyle]}
                testID="timeline-slider-start-handle"
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={t('settings.localDataRange')}
                accessibilityValue={{ text: formatHandleDate(startDate) }}
                accessibilityActions={STEP_ACTIONS}
                onAccessibilityAction={onStartAction}
              >
                {expandOnly ? (
                  <View style={[styles.bracketHandle, isDark && styles.bracketHandleDark]}>
                    <View style={[styles.bracketVertical, isDark && styles.bracketLineDark]} />
                    <View style={[styles.bracketHorizontalTop, isDark && styles.bracketLineDark]} />
                    <View
                      style={[styles.bracketHorizontalBottom, isDark && styles.bracketLineDark]}
                    />
                  </View>
                ) : (
                  <View style={[styles.handle, isDark && styles.handleDark]}>
                    <View style={styles.handleInner} />
                  </View>
                )}
              </Animated.View>
            </GestureDetector>

            {/* End handle - line style | for fixed, or circle for draggable */}
            {!fixedEnd ? (
              <GestureDetector gesture={endGesture}>
                <Animated.View
                  style={[styles.handleContainer, endHandleStyle]}
                  testID="timeline-slider-end-handle"
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={t('time.now')}
                  accessibilityValue={{ text: formatHandleDate(endDate) }}
                  accessibilityActions={STEP_ACTIONS}
                  onAccessibilityAction={onEndAction}
                >
                  <View style={[styles.handle, isDark && styles.handleDark]}>
                    <View style={styles.handleInner} />
                  </View>
                </Animated.View>
              </GestureDetector>
            ) : (
              <Animated.View style={[styles.handleContainer, endHandleStyle]}>
                <View style={[styles.lineHandle, isDark && styles.lineHandleDark]} />
              </Animated.View>
            )}
          </View>
        </GestureDetector>

        {/* Tick marks and labels */}
        {trackWidth > 0 && (
          <View style={styles.tickContainer}>
            {snapPoints.map((point, index) => {
              const pixelPos = point.position * trackWidth;
              const labelText = tickLabels[index];

              return (
                <React.Fragment key={`${point.kind}-${index}`}>
                  <View
                    style={[
                      styles.tickMark,
                      isDark && styles.tickMarkDark,
                      { left: pixelPos - 0.5 },
                    ]}
                  />
                  {point.showLabel && (
                    <Text
                      style={[
                        styles.tickLabelBase,
                        isDark && styles.tickLabelDark,
                        { left: pixelPos - 14, width: 28, textAlign: 'center' },
                      ]}
                      numberOfLines={1}
                    >
                      {labelText}
                    </Text>
                  )}
                </React.Fragment>
              );
            })}
          </View>
        )}

        {/* Activity count */}
        <View style={styles.footerRow}>
          <Text style={[styles.countLabel, isDark && styles.countLabelDark]}>
            {isLoading
              ? t('common.loading')
              : t('maps.activitiesCount', { count: activityCount || 0 })}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {},
  container: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.sm,
    paddingHorizontal: layout.cardMargin,
  },
  sliderContainer: {
    height: layout.minTapTarget,
    justifyContent: 'center',
    marginHorizontal: spacing.md,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: colors.border,
    borderRadius: layout.borderRadiusFull,
  },
  selectedRange: {
    position: 'absolute',
    height: 6,
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusFull,
  },
  handleContainer: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handle: {
    width: 24,
    height: 24,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...smallElementShadow(),
  },
  handleInner: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.primary,
  },
  // Bracket handle [ for expandable start
  bracketHandle: {
    width: 20,
    height: 24,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  bracketVertical: {
    position: 'absolute',
    left: 4,
    width: 3,
    height: 24,
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusFull,
  },
  bracketHorizontalTop: {
    position: 'absolute',
    left: 4,
    top: 0,
    width: 10,
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusFull,
  },
  bracketHorizontalBottom: {
    position: 'absolute',
    left: 4,
    bottom: 0,
    width: 10,
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusFull,
  },
  bracketHandleDark: {},
  bracketLineDark: {
    backgroundColor: colors.primary,
  },
  // Line handle | for fixed end
  lineHandle: {
    width: 3,
    height: 24,
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusFull,
  },
  lineHandleDark: {
    backgroundColor: colors.primary,
  },
  tickContainer: {
    position: 'relative',
    height: 20,
    marginTop: spacing.xxs,
    marginHorizontal: spacing.md,
    overflow: 'visible',
  },
  tickMark: {
    position: 'absolute',
    top: 0,
    width: 1,
    height: 5,
    backgroundColor: colors.textSecondary,
  },
  tickLabelBase: {
    position: 'absolute',
    top: 6,
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  countLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  // Dark mode
  containerDark: {
    backgroundColor: 'transparent',
  },
  trackDark: {
    backgroundColor: darkColors.border,
  },
  handleDark: {
    backgroundColor: darkColors.surface,
  },
  tickMarkDark: {
    backgroundColor: darkColors.textMuted,
  },
  tickLabelDark: {
    color: darkColors.textMuted,
  },
  countLabelDark: {
    color: colors.textOnDark,
  },
});
