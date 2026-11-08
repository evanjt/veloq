import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  LayoutChangeEvent,
  Platform,
  AccessibilityActionEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import * as haptics from '@/shared/ui/haptics';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';
import {
  colors,
  colorWithOpacity,
  darkColors,
  opacity,
  typography,
  spacing,
  layout,
  smallElementShadow,
  stroke,
  themePalette,
} from '@/theme';
import {
  createTimelineLayout,
  addCalendarMonths,
  placeTickLabels,
} from '@/features/maps/lib/timelineLayout';
import { formatMonth, formatYear, getIntlLocale } from '@/shared/format/format';
import { DenseText, denseExtent } from '@/shared/ui/DenseText';

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
const HANDLE_HIT_SLOP_BOX = {
  top: HANDLE_HIT_SLOP,
  bottom: HANDLE_HIT_SLOP,
  left: HANDLE_HIT_SLOP,
  right: HANDLE_HIT_SLOP,
};
/** A handle drag claims a horizontal move past this, and yields to a vertical one past it. */
const HANDLE_DRAG_SLOP = 10;
const MIN_RANGE = 0.02;
const POSITION_EPSILON = 1e-9;
const STEP_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];
/** Tick labels sit under the tick mark, and the row is tall enough for one line at the cap. */
const TICK_LABEL_TOP = 6;
const TICK_ROW_HEIGHT = TICK_LABEL_TOP + denseExtent(typography.micro.fontSize, 1.4);

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
  // The gesture worklets read the width from here, so they stay the same object across layouts.
  const trackWidthValue = useSharedValue(0);

  const { dateToPosition, positionToDate, snapPoints, snapToNearest } = useMemo(
    () => createTimelineLayout({ minDate, maxDate, trackWidth }),
    [minDate, maxDate, trackWidth]
  );

  // Shared values for animation
  const startPos = useSharedValue(dateToPosition(startDate));
  const endPos = useSharedValue(dateToPosition(endDate));
  const startPosAtGestureStart = useSharedValue(0);
  const endPosAtGestureStart = useSharedValue(0);
  // In expandOnly mode the start's limit: the downloaded start, which the gesture worklets read.
  const downloadedStartPos = useSharedValue(dateToPosition(startDate));
  // The start last reported through onRangeChange. In expandOnly mode the handle can sit left of
  // the prop while a span is proposed, so a month step runs from this rather than from the prop.
  const reportedStart = useRef(startDate);

  // Sync shared values when props change
  useEffect(() => {
    startPos.value = dateToPosition(startDate);
    endPos.value = dateToPosition(endDate);
    downloadedStartPos.value = dateToPosition(startDate);
    reportedStart.current = startDate;
  }, [startDate, endDate, dateToPosition, startPos, endPos, downloadedStartPos, resetKey]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const width = e.nativeEvent.layout.width;
      trackWidthValue.value = width;
      setTrackWidth(width);
    },
    [trackWidthValue]
  );

  const tickLabels = useMemo(
    () =>
      snapPoints.map((point) => {
        if (point.kind === 'year') return formatYear(point.date, true);
        if (point.kind === 'quarter') return formatMonth(point.date);
        return t('time.now');
      }),
    [snapPoints, t]
  );

  // Each label's own width, keyed by its text, so a translation or a larger text size places it
  // by what it actually takes rather than by a fixed box.
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const measureLabel = useCallback((text: string, e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    setLabelWidths((current) => {
      const known = current[text];
      return known !== undefined && Math.abs(known - width) < 0.5
        ? current
        : { ...current, [text]: width };
    });
  }, []);
  const placements = useMemo(() => {
    const widths = tickLabels.map((text) => labelWidths[text]);
    return new Map(
      placeTickLabels(snapPoints, widths, trackWidth).map((p) => [p.index, p] as const)
    );
  }, [snapPoints, tickLabels, labelWidths, trackWidth]);

  const triggerHaptic = useCallback(() => {
    haptics.light();
  }, []);

  // In expandOnly mode a start at the downloaded start is that date exactly, so a return to it
  // is recognised by the host as no proposal rather than a date a rounding error short of it.
  const startDateAt = useCallback(
    (startPosValue: number) => {
      if (expandOnly && startPosValue >= downloadedStartPos.value - POSITION_EPSILON) {
        return startDate;
      }
      return positionToDate(startPosValue);
    },
    [expandOnly, startDate, downloadedStartPos, positionToDate]
  );

  const updateDatesFromPositions = useCallback(
    (startPosValue: number, endPosValue: number) => {
      const start = startDateAt(startPosValue);
      const end = positionToDate(endPosValue);
      reportedStart.current = start;
      onRangeChange(start, end);
    },
    [startDateAt, positionToDate, onRangeChange]
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
  const snapOnJS = useGestureCallback(applySnapAndUpdate);

  // Handle tap on track to move left handle
  const handleTrackTap = useCallback(
    (tapX: number) => {
      if (trackWidth === 0) return;

      const tapPosition = Math.max(0, Math.min(1, tapX / trackWidth));
      // In expandOnly mode the start may be tapped anywhere at or left of the downloaded start
      const limit = expandOnly ? downloadedStartPos.value : undefined;
      if (limit !== undefined && tapPosition > limit) return;
      const targetPos = snapToNearest(tapPosition, limit).position;

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
      downloadedStartPos,
      startPos,
      endPos,
    ]
  );
  const trackTapOnJS = useGestureCallback(handleTrackTap);

  const stepStart = useCallback(
    (direction: 1 | -1) => {
      const current = expandOnly ? reportedStart.current : startDate;
      let target = addCalendarMonths(current, direction);
      if (target < minDate) target = minDate;
      if (expandOnly && target > startDate) target = startDate;
      if (target.getTime() === current.getTime() || target >= endDate) return;
      startPos.value = dateToPosition(target);
      reportedStart.current = target;
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

  // Built once per set of inputs. A rebuilt gesture is a new native handler, and one that replaces
  // a handler mid-drag drops the touch that handler holds, so the engine-driven re-renders while a
  // download runs must not build them again. A vertical move past the slop before a horizontal one
  // fails a handle, which leaves the touch to the surrounding sheet. A handle that is active blocks
  // the track tap from firing.
  const { trackTapGesture, startGesture, endGesture } = useMemo(() => {
    const trackTap = Gesture.Tap().onEnd((e) => {
      runOnJS(trackTapOnJS)(e.x);
    });

    const start = Gesture.Pan()
      .hitSlop(HANDLE_HIT_SLOP_BOX)
      .activeOffsetX([-HANDLE_DRAG_SLOP, HANDLE_DRAG_SLOP])
      .failOffsetY([-HANDLE_DRAG_SLOP, HANDLE_DRAG_SLOP])
      .blocksExternalGesture(trackTap)
      .onBegin(() => {
        startPosAtGestureStart.value = startPos.value;
      })
      .onUpdate((e) => {
        const width = trackWidthValue.value;
        if (width === 0) return;
        const delta = e.translationX / width;
        let newPos = startPosAtGestureStart.value + delta;

        // In expandOnly mode the start moves freely left of the downloaded start, and no further right
        if (expandOnly) {
          newPos = Math.min(newPos, downloadedStartPos.value);
        }

        newPos = Math.max(0, Math.min(endPos.value - MIN_RANGE, newPos));
        startPos.value = newPos;
      })
      .onEnd(() => {
        runOnJS(snapOnJS)(
          startPos.value,
          endPos.value,
          expandOnly ? downloadedStartPos.value : undefined
        );
      });

    const end = Gesture.Pan()
      .hitSlop(HANDLE_HIT_SLOP_BOX)
      .activeOffsetX([-HANDLE_DRAG_SLOP, HANDLE_DRAG_SLOP])
      .failOffsetY([-HANDLE_DRAG_SLOP, HANDLE_DRAG_SLOP])
      .blocksExternalGesture(trackTap)
      .onBegin(() => {
        endPosAtGestureStart.value = endPos.value;
      })
      .onUpdate((e) => {
        const width = trackWidthValue.value;
        if (width === 0) return;
        const delta = e.translationX / width;
        const newPos = Math.max(
          startPos.value + MIN_RANGE,
          Math.min(1, endPosAtGestureStart.value + delta)
        );
        endPos.value = newPos;
      })
      .onEnd(() => {
        runOnJS(snapOnJS)(startPos.value, endPos.value);
      });

    return { trackTapGesture: trackTap, startGesture: start, endGesture: end };
  }, [
    expandOnly,
    trackTapOnJS,
    snapOnJS,
    startPos,
    endPos,
    startPosAtGestureStart,
    endPosAtGestureStart,
    downloadedStartPos,
    trackWidthValue,
  ]);

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

  // Expand-only: the downloaded span runs from the downloaded start to now, and the proposed span
  // from the handle to the downloaded start. The proposed span is hidden while the handle is on it.
  const downloadedRangeStyle = useAnimatedStyle(() => ({
    left: downloadedStartPos.value * trackWidth,
    right: trackWidth - endPos.value * trackWidth,
  }));

  const proposedRangeStyle = useAnimatedStyle(() => ({
    left: startPos.value * trackWidth,
    right: trackWidth - downloadedStartPos.value * trackWidth,
    display:
      startPos.value < downloadedStartPos.value - POSITION_EPSILON
        ? ('flex' as const)
        : ('none' as const),
  }));

  const primary = themePalette(isDark).actionPrimary;
  const markFill = { backgroundColor: primary };
  const proposedFill = { backgroundColor: colorWithOpacity(primary, opacity.tint3) };
  const handleRing = { borderColor: primary };

  return (
    <View style={styles.wrapper} testID="timeline-slider">
      <View style={[styles.container, isDark && styles.containerDark]}>
        {/* Slider track */}
        <GestureDetector gesture={trackTapGesture}>
          <View style={styles.sliderContainer} onLayout={onLayout} testID="timeline-slider-track">
            <View style={[styles.track, isDark && styles.trackDark]} />

            {expandOnly ? (
              <>
                <Animated.View
                  style={[styles.selectedRange, markFill, downloadedRangeStyle]}
                  testID="timeline-slider-downloaded-range"
                />
                <Animated.View
                  style={[styles.selectedRange, proposedFill, proposedRangeStyle]}
                  testID="timeline-slider-proposed-range"
                />
              </>
            ) : (
              <Animated.View style={[styles.selectedRange, markFill, rangeStyle]} />
            )}

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
                    <View style={[styles.bracketVertical, markFill]} />
                    <View style={[styles.bracketHorizontalTop, markFill]} />
                    <View style={[styles.bracketHorizontalBottom, markFill]} />
                  </View>
                ) : (
                  <View style={[styles.handle, isDark && styles.handleDark, handleRing]}>
                    <View style={[styles.handleInner, markFill]} />
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
                  accessibilityLabel={t('settings.localDataRangeEnd')}
                  accessibilityValue={{ text: formatHandleDate(endDate) }}
                  accessibilityActions={STEP_ACTIONS}
                  onAccessibilityAction={onEndAction}
                >
                  <View style={[styles.handle, isDark && styles.handleDark, handleRing]}>
                    <View style={[styles.handleInner, markFill]} />
                  </View>
                </Animated.View>
              </GestureDetector>
            ) : (
              <Animated.View style={[styles.handleContainer, endHandleStyle]}>
                <View style={[styles.lineHandle, markFill]} />
              </Animated.View>
            )}
          </View>
        </GestureDetector>

        {/* Tick marks and labels */}
        {trackWidth > 0 && (
          <View style={styles.tickContainer}>
            {snapPoints.map((point, index) => {
              const pixelPos = point.position * trackWidth;
              const labelText = tickLabels[index] ?? '';
              const placement = placements.get(index);

              return (
                <React.Fragment key={`${point.kind}-${index}`}>
                  <View
                    style={[
                      styles.tickMark,
                      isDark && styles.tickMarkDark,
                      { left: pixelPos - 0.5 },
                    ]}
                  />
                  {point.showLabel ? (
                    <DenseText
                      testID={`timeline-tick-label-${index}`}
                      onLayout={(e) => measureLabel(labelText, e)}
                      style={[
                        styles.tickLabelBase,
                        isDark && styles.tickLabelDark,
                        placement ? { left: placement.left } : styles.tickLabelUnplaced,
                      ]}
                      numberOfLines={1}
                    >
                      {labelText}
                    </DenseText>
                  ) : null}
                </React.Fragment>
              );
            })}
          </View>
        )}

        {/* Activity count */}
        <View style={styles.footerRow}>
          <DenseText style={[styles.countLabel, isDark && styles.countLabelDark]}>
            {isLoading
              ? t('common.loading')
              : t('maps.activitiesCount', { count: activityCount || 0 })}
          </DenseText>
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
    borderWidth: stroke.two,
    justifyContent: 'center',
    alignItems: 'center',
    ...smallElementShadow(),
  },
  handleInner: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
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
    borderRadius: layout.borderRadiusFull,
  },
  bracketHorizontalTop: {
    position: 'absolute',
    left: 4,
    top: 0,
    width: 10,
    height: 3,
    borderRadius: layout.borderRadiusFull,
  },
  bracketHorizontalBottom: {
    position: 'absolute',
    left: 4,
    bottom: 0,
    width: 10,
    height: 3,
    borderRadius: layout.borderRadiusFull,
  },
  bracketHandleDark: {},
  // Line handle | for fixed end
  lineHandle: {
    width: 3,
    height: 24,
    borderRadius: layout.borderRadiusFull,
  },
  tickContainer: {
    position: 'relative',
    height: TICK_ROW_HEIGHT,
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
    ...typography.micro,
    position: 'absolute',
    top: TICK_LABEL_TOP,
    color: colors.textSecondary,
  },
  tickLabelUnplaced: {
    left: 0,
    opacity: 0,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  countLabel: {
    ...typography.captionBold,
    color: colors.textPrimary,
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
    backgroundColor: darkColors.textSecondary,
  },
  tickLabelDark: {
    color: darkColors.textSecondary,
  },
  countLabelDark: {
    color: colors.textOnFill,
  },
});
