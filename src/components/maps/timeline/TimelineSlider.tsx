import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { smallElementShadow } from '@/theme/shadows';
import { SyncProgressBanner } from './SyncProgressBanner';
import { TimelineLegend } from './TimelineLegend';
import { ActivityCategoryFilter } from './ActivityCategoryFilter';

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
  /** Oldest date in cache */
  cachedOldest?: Date | null;
  /** Newest date in cache */
  cachedNewest?: Date | null;
  /** Activity type filter - selected types */
  selectedTypes?: Set<string>;
  /** Activity type filter - available types */
  availableTypes?: string[];
  /** Activity type filter - callback when selection changes */
  onTypeSelectionChange?: (types: Set<string>) => void;
  /** Dark mode */
  isDark?: boolean;
  /** Show activity type filter (default: true) */
  showActivityFilter?: boolean;
  /** Show cached range striped indicator (default: true) */
  showCachedRange?: boolean;
  /** Show legend (default: true) */
  showLegend?: boolean;
  /** Fix end handle at "now" - cannot be dragged (default: false) */
  fixedEnd?: boolean;
  /** Only allow start handle to move left (expand range, never contract) (default: false) */
  expandOnly?: boolean;
  /** Show sync progress banner (default: true) - set false when global banner is visible */
  showSyncBanner?: boolean;
}

// Larger touch area for handles
const HANDLE_SIZE = 28;
const HANDLE_HIT_SLOP = Platform.select({ ios: 30, default: 20 });
const MIN_RANGE = 0.02;

// Non-linear scale constants
const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const RECENT_YEAR_POSITION = 0.5; // Right half (0.5-1.0) = last 12 months

export function TimelineSlider({
  minDate,
  maxDate,
  startDate,
  endDate,
  onRangeChange,
  isLoading,
  activityCount,
  cachedOldest,
  cachedNewest,
  selectedTypes,
  availableTypes,
  onTypeSelectionChange,
  isDark = false,
  showActivityFilter = true,
  showCachedRange = true,
  showLegend = true,
  fixedEnd = false,
  expandOnly = false,
  showSyncBanner = true,
}: TimelineSliderProps) {
  const { t } = useTranslation();
  const [trackWidth, setTrackWidth] = useState(0);

  // Non-linear scale calculations
  const oneYearAgo = useMemo(() => new Date(maxDate.getTime() - ONE_YEAR_MS), [maxDate]);

  const olderYears = useMemo(() => {
    const olderRangeMs = Math.max(0, oneYearAgo.getTime() - minDate.getTime());
    return Math.max(1, Math.ceil(olderRangeMs / ONE_YEAR_MS));
  }, [oneYearAgo, minDate]);

  // Convert date to slider position (0-1) using non-linear scale
  const dateToPosition = useCallback(
    (date: Date): number => {
      const time = date.getTime();

      if (time >= oneYearAgo.getTime()) {
        const recentProgress = Math.min(1, (time - oneYearAgo.getTime()) / ONE_YEAR_MS);
        return RECENT_YEAR_POSITION + recentProgress * RECENT_YEAR_POSITION;
      } else {
        const yearsFromOneYearAgo = (oneYearAgo.getTime() - time) / ONE_YEAR_MS;
        const positionPerYear = RECENT_YEAR_POSITION / olderYears;
        const position = RECENT_YEAR_POSITION - yearsFromOneYearAgo * positionPerYear;
        return Math.max(0, position);
      }
    },
    [oneYearAgo, olderYears]
  );

  // Convert slider position (0-1) to date using non-linear scale
  const positionToDate = useCallback(
    (pos: number): Date => {
      if (pos >= RECENT_YEAR_POSITION) {
        const recentProgress = (pos - RECENT_YEAR_POSITION) / RECENT_YEAR_POSITION;
        const time = oneYearAgo.getTime() + recentProgress * ONE_YEAR_MS;
        return new Date(Math.min(time, maxDate.getTime()));
      } else {
        const positionPerYear = RECENT_YEAR_POSITION / olderYears;
        const yearsFromOneYearAgo = (RECENT_YEAR_POSITION - pos) / positionPerYear;
        const time = oneYearAgo.getTime() - yearsFromOneYearAgo * ONE_YEAR_MS;
        return new Date(Math.max(time, minDate.getTime()));
      }
    },
    [oneYearAgo, olderYears, minDate, maxDate]
  );

  // Shared values for animation
  const startPos = useSharedValue(dateToPosition(startDate));
  const endPos = useSharedValue(dateToPosition(endDate));
  const startPosAtGestureStart = useSharedValue(0);
  const endPosAtGestureStart = useSharedValue(0);

  // Calculate cached range positions
  const cachedRange = useMemo(() => {
    if (!cachedOldest || !cachedNewest) {
      return { start: 0, end: 0, hasCache: false };
    }
    const start = Math.max(0, dateToPosition(cachedOldest));
    const end = Math.min(1, dateToPosition(cachedNewest));
    return { start, end, hasCache: true };
  }, [cachedOldest, cachedNewest, dateToPosition]);

  // Sync shared values when props change
  useEffect(() => {
    startPos.value = dateToPosition(startDate);
    endPos.value = dateToPosition(endDate);
  }, [startDate, endDate, dateToPosition]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  // Generate snap points for year boundaries and quarterly months
  const snapPoints = useMemo(() => {
    const points: {
      position: number;
      label: string;
      date: Date;
      isMonth?: boolean;
      showLabel?: boolean;
    }[] = [];

    // Older years (left half: 0-0.5)
    const positionPerYear = RECENT_YEAR_POSITION / olderYears;
    // Skip years when labels would be too close (< 40px apart)
    const olderYearsWidth = trackWidth * RECENT_YEAR_POSITION;
    const pixelsPerYear = olderYearsWidth / olderYears;
    const yearStep = pixelsPerYear < 40 ? Math.ceil(40 / pixelsPerYear) : 1;

    for (let i = 0; i <= olderYears; i++) {
      const position = i * positionPerYear;
      const yearsBack = olderYears - i + 1;
      const date = new Date(maxDate.getTime() - yearsBack * ONE_YEAR_MS);
      // Always keep snap points for all years, but only show labels for visible ones
      const showLabel = i % yearStep === 0 || i === olderYears;
      points.push({
        position,
        label: date.getFullYear().toString(),
        date,
        showLabel,
      });
    }

    // Quarters in recent year (right half: 0.5-1.0)
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    for (let i = 1; i <= 3; i++) {
      const position = RECENT_YEAR_POSITION + (i / 4) * RECENT_YEAR_POSITION;
      const monthsBack = 12 - i * 3;
      const date = new Date(maxDate);
      date.setMonth(date.getMonth() - monthsBack);
      date.setDate(1);
      points.push({
        position,
        label: monthNames[date.getMonth()],
        date,
        isMonth: true,
        showLabel: true,
      });
    }

    // Today at position 1.0
    points.push({
      position: 1,
      label: t('time.now'),
      date: maxDate,
      showLabel: true,
    });

    return points;
  }, [olderYears, maxDate, t, trackWidth]);

  // Snap position to nearest snap point
  const snapToNearest = useCallback(
    (pos: number): { position: number; snapped: boolean } => {
      const SNAP_THRESHOLD = 0.08;
      let closestPoint = pos;
      let closestDistance = Infinity;

      for (const point of snapPoints) {
        const distance = Math.abs(pos - point.position);
        if (distance < closestDistance && distance < SNAP_THRESHOLD) {
          closestDistance = distance;
          closestPoint = point.position;
        }
      }

      return { position: closestPoint, snapped: closestPoint !== pos };
    },
    [snapPoints]
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
    (startPosValue: number, endPosValue: number) => {
      const startResult = snapToNearest(startPosValue);
      const endResult = snapToNearest(endPosValue);
      startPos.value = startResult.position;
      endPos.value = endResult.position;

      if (startResult.snapped || endResult.snapped) {
        triggerHaptic();
      }

      updateDatesFromPositions(startResult.position, endResult.position);
    },
    [snapToNearest, updateDatesFromPositions, triggerHaptic]
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
    [trackWidth, snapToNearest, triggerHaptic, updateDatesFromPositions, expandOnly]
  );

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
      runOnJS(applySnapAndUpdate)(startPos.value, endPos.value);
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

  const cachedRangeStyle = useMemo(
    () => ({
      left: cachedRange.start * trackWidth,
      width: (cachedRange.end - cachedRange.start) * trackWidth,
    }),
    [cachedRange, trackWidth]
  );

  return (
    <View style={styles.wrapper} testID="timeline-slider">
      {/* SyncProgressBanner manages its own state via hooks - no props needed */}
      {showSyncBanner && <SyncProgressBanner />}

      <View style={[styles.container, isDark && styles.containerDark]}>
        {/* Activity category filter */}
        {showActivityFilter && availableTypes && selectedTypes && onTypeSelectionChange && (
          <ActivityCategoryFilter
            selectedTypes={selectedTypes}
            availableTypes={availableTypes}
            onSelectionChange={onTypeSelectionChange}
            isDark={isDark}
          />
        )}

        {/* Slider track */}
        <GestureDetector gesture={trackTapGesture}>
          <View style={styles.sliderContainer} onLayout={onLayout}>
            <View style={[styles.track, isDark && styles.trackDark]} />

            {/* Cached range with stripes */}
            {showCachedRange &&
              cachedRange.hasCache &&
              trackWidth > 0 &&
              cachedRangeStyle.width > 0 && (
                <View style={[styles.cachedRange, cachedRangeStyle]}>
                  <View style={styles.stripeContainer}>
                    {Array.from({
                      length: Math.ceil(cachedRangeStyle.width / 3),
                    }).map((_, i) => (
                      <View
                        key={i}
                        style={[
                          styles.stripe,
                          {
                            backgroundColor:
                              i % 2 === 0
                                ? colors.primary
                                : isDark
                                  ? 'rgba(60,60,60,0.8)'
                                  : 'rgba(255,255,255,0.8)',
                          },
                        ]}
                      />
                    ))}
                  </View>
                </View>
              )}

            <Animated.View style={[styles.selectedRange, rangeStyle]} />

            {/* Start handle - bracket style [ for expandable */}
            <GestureDetector gesture={startGesture}>
              <Animated.View style={[styles.handleContainer, startHandleStyle]}>
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
                <Animated.View style={[styles.handleContainer, endHandleStyle]}>
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
              const isYear = /^\d{4}$/.test(point.label);
              const pixelPos = point.position * trackWidth;
              const labelText = isYear ? `'${point.label.slice(-2)}` : point.label;

              return (
                <React.Fragment key={`${point.label}-${index}`}>
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

        {/* Activity count and legend row */}
        <View style={styles.footerRow}>
          <Text style={[styles.countLabel, isDark && styles.countLabelDark]}>
            {isLoading
              ? t('common.loading')
              : t('maps.activitiesCount', { count: activityCount || 0 })}
          </Text>
          {showLegend && <TimelineLegend isDark={isDark} compact />}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {},
  container: {
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: layout.cardMargin,
  },
  sliderContainer: {
    height: layout.minTapTarget,
    justifyContent: 'center',
    marginHorizontal: 14,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
  },
  cachedRange: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  stripeContainer: {
    flexDirection: 'row',
    height: '100%',
  },
  stripe: {
    width: 3,
    height: '100%',
  },
  selectedRange: {
    position: 'absolute',
    height: 6,
    backgroundColor: colors.primary,
    borderRadius: 3,
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
    borderRadius: 12,
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
    borderRadius: 4,
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
    borderRadius: 1.5,
  },
  bracketHorizontalTop: {
    position: 'absolute',
    left: 4,
    top: 0,
    width: 10,
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 1.5,
  },
  bracketHorizontalBottom: {
    position: 'absolute',
    left: 4,
    bottom: 0,
    width: 10,
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 1.5,
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
    borderRadius: 1.5,
  },
  lineHandleDark: {
    backgroundColor: colors.primary,
  },
  tickContainer: {
    position: 'relative',
    height: 20,
    marginTop: 2,
    marginHorizontal: 14,
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
