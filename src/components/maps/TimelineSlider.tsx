import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  LayoutChangeEvent,
  ScrollView,
  Platform,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows, smallElementShadow } from '@/theme/shadows';
import { ACTIVITY_CATEGORIES, getActivityCategory, groupTypesByCategory } from './ActivityTypeFilter';

interface SyncProgress {
  completed: number;
  total: number;
  message?: string;
}

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
  /** Sync progress for background sync */
  syncProgress?: SyncProgress | null;
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
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit'
  });
}

// Larger touch area for handles
// iOS needs larger hit areas for reliable touch detection on high-DPI screens
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
  syncProgress,
  cachedOldest,
  cachedNewest,
  selectedTypes,
  availableTypes,
  onTypeSelectionChange,
  isDark = false,
}: TimelineSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);

  // Group available types into categories
  const availableCategories = useMemo(() => {
    if (!availableTypes) return [];
    const grouped = groupTypesByCategory(availableTypes);
    // Return categories in a consistent order, only those that have types
    const categoryOrder = ['Ride', 'Run', 'Swim', 'Walk', 'Hike', 'Other'];
    return categoryOrder.filter(cat => grouped.has(cat));
  }, [availableTypes]);

  // Check if a category is fully selected (all its types are selected)
  const isCategorySelected = useCallback((category: string) => {
    if (!selectedTypes || !availableTypes) return false;
    const categoryTypes = availableTypes.filter(t => getActivityCategory(t) === category);
    return categoryTypes.length > 0 && categoryTypes.every(t => selectedTypes.has(t));
  }, [selectedTypes, availableTypes]);

  // Toggle all types in a category
  const toggleCategory = useCallback((category: string) => {
    if (!selectedTypes || !onTypeSelectionChange || !availableTypes) return;
    const categoryTypes = availableTypes.filter(t => getActivityCategory(t) === category);
    const newSelection = new Set(selectedTypes);
    const allSelected = categoryTypes.every(t => selectedTypes.has(t));

    if (allSelected) {
      // Deselect all types in this category
      categoryTypes.forEach(t => newSelection.delete(t));
    } else {
      // Select all types in this category
      categoryTypes.forEach(t => newSelection.add(t));
    }
    onTypeSelectionChange(newSelection);
  }, [selectedTypes, onTypeSelectionChange, availableTypes]);

  const toggleAllTypes = useCallback(() => {
    if (!availableTypes || !onTypeSelectionChange || !selectedTypes) return;
    if (selectedTypes.size === availableTypes.length) {
      onTypeSelectionChange(new Set());
    } else {
      onTypeSelectionChange(new Set(availableTypes));
    }
  }, [availableTypes, selectedTypes, onTypeSelectionChange]);

  // Non-linear scale:
  // - Right half (0.5-1.0): last 12 months (recent data, more precise)
  // - Left half (0.0-0.5): all older years (compressed, equal space per year)
  const oneYearAgo = useMemo(() => new Date(maxDate.getTime() - ONE_YEAR_MS), [maxDate]);

  // Calculate how many older years exist (before the last 12 months)
  const olderYears = useMemo(() => {
    const olderRangeMs = Math.max(0, oneYearAgo.getTime() - minDate.getTime());
    return Math.max(1, Math.ceil(olderRangeMs / ONE_YEAR_MS));
  }, [oneYearAgo, minDate]);

  // Convert date to slider position (0-1) using non-linear scale
  const dateToPosition = useCallback((date: Date): number => {
    const time = date.getTime();

    if (time >= oneYearAgo.getTime()) {
      // Recent year: maps to 0.5-1.0
      const recentProgress = Math.min(1, (time - oneYearAgo.getTime()) / ONE_YEAR_MS);
      return RECENT_YEAR_POSITION + recentProgress * RECENT_YEAR_POSITION;
    } else {
      // Older years: maps to 0.0-0.5
      const yearsFromOneYearAgo = (oneYearAgo.getTime() - time) / ONE_YEAR_MS;
      const positionPerYear = RECENT_YEAR_POSITION / olderYears;
      const position = RECENT_YEAR_POSITION - yearsFromOneYearAgo * positionPerYear;
      return Math.max(0, position);
    }
  }, [oneYearAgo, olderYears]);

  // Convert slider position (0-1) to date using non-linear scale
  const positionToDate = useCallback((pos: number): Date => {
    if (pos >= RECENT_YEAR_POSITION) {
      // Recent year section (right half)
      const recentProgress = (pos - RECENT_YEAR_POSITION) / RECENT_YEAR_POSITION;
      const time = oneYearAgo.getTime() + recentProgress * ONE_YEAR_MS;
      return new Date(Math.min(time, maxDate.getTime()));
    } else {
      // Older years section (left half)
      const positionPerYear = RECENT_YEAR_POSITION / olderYears;
      const yearsFromOneYearAgo = (RECENT_YEAR_POSITION - pos) / positionPerYear;
      const time = oneYearAgo.getTime() - yearsFromOneYearAgo * ONE_YEAR_MS;
      return new Date(Math.max(time, minDate.getTime()));
    }
  }, [oneYearAgo, olderYears, minDate, maxDate]);

  // Convert dates to positions using non-linear scale
  const startPos = useSharedValue(dateToPosition(startDate));
  const endPos = useSharedValue(dateToPosition(endDate));

  // Track starting position for gestures
  const startPosAtGestureStart = useSharedValue(0);
  const endPosAtGestureStart = useSharedValue(0);

  // Calculate cached range positions using non-linear scale
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
    const points: { position: number; label: string; date: Date; isMonth?: boolean; showLabel?: boolean }[] = [];

    // Add snap points for older years (left half: 0-0.5)
    const positionPerYear = RECENT_YEAR_POSITION / olderYears;
    for (let i = 0; i <= olderYears; i++) {
      const position = i * positionPerYear;
      const yearsBack = olderYears - i + 1; // +1 because we're measuring from one year ago
      const date = new Date(maxDate.getTime() - yearsBack * ONE_YEAR_MS);
      points.push({
        position,
        label: date.getFullYear().toString(),
        date,
        showLabel: true,
      });
    }

    // Add snap points for quarters in recent year (right half: 0.5-1.0)
    // Show actual month names for the quarter boundaries
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 1; i <= 3; i++) {
      const position = RECENT_YEAR_POSITION + (i / 4) * RECENT_YEAR_POSITION;
      const monthsBack = 12 - (i * 3);
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

    // Add today at position 1.0
    points.push({
      position: 1,
      label: 'Now',
      date: maxDate,
      showLabel: true,
    });

    return points;
  }, [olderYears, maxDate]);

  // Snap position to nearest snap point with haptic feedback
  const snapToNearest = useCallback((pos: number): { position: number; snapped: boolean } => {
    const SNAP_THRESHOLD = 0.08; // Snap if within 8% of a snap point (increased for better feel)
    let closestPoint = pos;
    let closestDistance = Infinity;

    for (const point of snapPoints) {
      const distance = Math.abs(pos - point.position);
      if (distance < closestDistance && distance < SNAP_THRESHOLD) {
        closestDistance = distance;
        closestPoint = point.position;
      }
    }

    const snapped = closestPoint !== pos;
    return { position: closestPoint, snapped };
  }, [snapPoints]);

  // Trigger haptic feedback
  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const updateDatesFromPositions = useCallback((startPosValue: number, endPosValue: number) => {
    const start = positionToDate(startPosValue);
    const end = positionToDate(endPosValue);
    onRangeChange(start, end);
  }, [positionToDate, onRangeChange]);

  // Wrapper to apply snapping on gesture end
  const applySnapAndUpdate = useCallback((startPosValue: number, endPosValue: number) => {
    const startResult = snapToNearest(startPosValue);
    const endResult = snapToNearest(endPosValue);
    startPos.value = startResult.position;
    endPos.value = endResult.position;

    // Trigger haptic if either handle snapped
    if (startResult.snapped || endResult.snapped) {
      triggerHaptic();
    }

    updateDatesFromPositions(startResult.position, endResult.position);
  }, [snapToNearest, updateDatesFromPositions, triggerHaptic]);

  // Handle tap on track to move left handle (or both if tap is beyond right handle)
  const handleTrackTap = useCallback((tapX: number) => {
    if (trackWidth === 0) return;

    const tapPosition = Math.max(0, Math.min(1, tapX / trackWidth));
    const snappedResult = snapToNearest(tapPosition);
    const targetPos = snappedResult.position;

    if (targetPos >= endPos.value) {
      // Tap is at or beyond right handle - move right to 1.0 (Now) and left to tap position
      startPos.value = targetPos;
      endPos.value = 1;
      triggerHaptic();
      updateDatesFromPositions(targetPos, 1);
    } else {
      // Tap is to the left of right handle - just move left handle
      startPos.value = targetPos;
      triggerHaptic();
      updateDatesFromPositions(targetPos, endPos.value);
    }
  }, [trackWidth, snapToNearest, triggerHaptic, updateDatesFromPositions]);

  // Tap gesture for track - moves left handle to tap position
  const trackTapGesture = Gesture.Tap()
    .onEnd((e) => {
      runOnJS(handleTrackTap)(e.x);
    });

  const startGesture = Gesture.Pan()
    .hitSlop({ top: HANDLE_HIT_SLOP, bottom: HANDLE_HIT_SLOP, left: HANDLE_HIT_SLOP, right: HANDLE_HIT_SLOP })
    .onBegin(() => {
      startPosAtGestureStart.value = startPos.value;
    })
    .onUpdate((e) => {
      if (trackWidth === 0) return;
      const delta = e.translationX / trackWidth;
      const newPos = Math.max(0, Math.min(endPos.value - MIN_RANGE, startPosAtGestureStart.value + delta));
      startPos.value = newPos;
    })
    .onEnd(() => {
      runOnJS(applySnapAndUpdate)(startPos.value, endPos.value);
    });

  const endGesture = Gesture.Pan()
    .hitSlop({ top: HANDLE_HIT_SLOP, bottom: HANDLE_HIT_SLOP, left: HANDLE_HIT_SLOP, right: HANDLE_HIT_SLOP })
    .onBegin(() => {
      endPosAtGestureStart.value = endPos.value;
    })
    .onUpdate((e) => {
      if (trackWidth === 0) return;
      const delta = e.translationX / trackWidth;
      const newPos = Math.max(startPos.value + MIN_RANGE, Math.min(1, endPosAtGestureStart.value + delta));
      endPos.value = newPos;
    })
    .onEnd(() => {
      runOnJS(applySnapAndUpdate)(startPos.value, endPos.value);
    });

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

  // Cached range style (static, not animated) - use width instead of right for reliable rendering
  const cachedRangeStyle = useMemo(() => ({
    left: cachedRange.start * trackWidth,
    width: (cachedRange.end - cachedRange.start) * trackWidth,
  }), [cachedRange, trackWidth]);

  return (
    <View style={styles.wrapper}>
      {/* Sync progress banner */}
      {syncProgress && (
        <View style={styles.syncBanner}>
          <Text style={styles.syncText}>
            {syncProgress.message
              ? syncProgress.message
              : syncProgress.total > 0
                ? `Syncing ${syncProgress.completed}/${syncProgress.total} activities`
                : 'Syncing...'}
          </Text>
        </View>
      )}

      <View style={[styles.container, isDark && styles.containerDark]}>
        {/* Activity category filter chips */}
        {availableCategories.length > 0 && selectedTypes && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScrollContent}
            style={styles.filterScroll}
          >
            {/* All/Clear toggle */}
            <TouchableOpacity
              style={[styles.controlChip, isDark && styles.controlChipDark]}
              onPress={toggleAllTypes}
            >
              <Text style={[styles.controlText, isDark && styles.controlTextDark]}>
                {selectedTypes.size === availableTypes?.length ? 'Clear' : 'All'}
              </Text>
            </TouchableOpacity>

            {/* Category chips */}
            {availableCategories.map((category) => {
              const config = ACTIVITY_CATEGORIES[category];
              const isSelected = isCategorySelected(category);

              return (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.filterChip,
                    isSelected && { backgroundColor: config.color },
                    !isSelected && styles.filterChipUnselected,
                    !isSelected && isDark && styles.filterChipUnselectedDark,
                  ]}
                  onPress={() => toggleCategory(category)}
                >
                  <Ionicons
                    name={config.icon}
                    size={14}
                    color={isSelected ? colors.surface : config.color}
                  />
                  <Text
                    style={[
                      styles.filterChipText,
                      isSelected && styles.filterChipTextSelected,
                      !isSelected && { color: config.color },
                    ]}
                  >
                    {config.label}
                  </Text>
                </TouchableOpacity>
              );
            })}

          </ScrollView>
        )}

        {/* Slider track - wrapped in tap gesture for quick navigation */}
        <GestureDetector gesture={trackTapGesture}>
          <View style={styles.sliderContainer} onLayout={onLayout}>
            {/* Base track - grey (no data) */}
            <View style={[styles.track, isDark && styles.trackDark]} />

            {/* Cached range - striped pattern */}
            {cachedRange.hasCache && trackWidth > 0 && cachedRangeStyle.width > 0 && (
              <View style={[styles.cachedRange, cachedRangeStyle]}>
                {/* Create stripe pattern - need enough stripes to fill the cached range width */}
                <View style={styles.stripeContainer}>
                  {Array.from({ length: Math.ceil(cachedRangeStyle.width / 3) }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.stripe,
                        { backgroundColor: i % 2 === 0 ? colors.primary : (isDark ? 'rgba(60,60,60,0.8)' : 'rgba(255,255,255,0.8)') }
                      ]}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Selected range - solid orange */}
            <Animated.View style={[styles.selectedRange, rangeStyle]} />

            {/* Start handle */}
            <GestureDetector gesture={startGesture}>
              <Animated.View style={[styles.handleContainer, startHandleStyle]}>
                <View style={[styles.handle, isDark && styles.handleDark]}>
                  <View style={styles.handleInner} />
                </View>
              </Animated.View>
            </GestureDetector>

            {/* End handle */}
            <GestureDetector gesture={endGesture}>
              <Animated.View style={[styles.handleContainer, endHandleStyle]}>
                <View style={[styles.handle, isDark && styles.handleDark]}>
                  <View style={styles.handleInner} />
                </View>
              </Animated.View>
            </GestureDetector>
          </View>
        </GestureDetector>

        {/* Year/quarter tick marks and labels */}
        {trackWidth > 0 && (
          <View style={styles.tickContainer}>
            {snapPoints.map((point, index) => {
              const isYear = /^\d{4}$/.test(point.label);
              const pixelPos = point.position * trackWidth;

              // Format label text - shorten years to '21, '22, etc.
              const labelText = isYear ? `'${point.label.slice(-2)}` : point.label;

              return (
                <React.Fragment key={`${point.label}-${index}`}>
                  {/* Tick mark */}
                  <View style={[styles.tickMark, isDark && styles.tickMarkDark, { left: pixelPos - 0.5 }]} />
                  {/* Label - all centered under tick */}
                  <Text
                    style={[styles.tickLabelBase, isDark && styles.tickLabelDark, { left: pixelPos - 14, width: 28, textAlign: 'center' }]}
                    numberOfLines={1}
                  >
                    {labelText}
                  </Text>
                </React.Fragment>
              );
            })}
          </View>
        )}

        {/* Activity count */}
        <View style={styles.countContainer}>
          <Text style={[styles.countLabel, isDark && styles.countLabelDark]}>
            {isLoading ? 'Loading...' : `${activityCount || 0} activities`}
          </Text>
        </View>

        {/* Legend */}
        <View style={[styles.legend, isDark && styles.legendDark]}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendSelected]} />
            <Text style={[styles.legendText, isDark && styles.legendTextDark]}>Selected</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendCached]}>
              <View style={styles.legendStripe} />
            </View>
            <Text style={[styles.legendText, isDark && styles.legendTextDark]}>Cached</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendEmpty, isDark && styles.legendEmptyDark]} />
            <Text style={[styles.legendText, isDark && styles.legendTextDark]}>Not synced</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {},
  syncBanner: {
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  syncText: {
    color: colors.textOnDark,
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
  },
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 10,
    paddingHorizontal: layout.cardMargin,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
    // Platform-optimized shadow for small interactive elements
    ...smallElementShadow(),
  },
  handleInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  dateLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  countLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendSwatch: {
    width: 16,
    height: 8,
    borderRadius: 2,
  },
  legendSelected: {
    backgroundColor: colors.primary,
  },
  legendCached: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  legendStripe: {
    width: 8,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  legendEmpty: {
    backgroundColor: colors.border,
  },
  legendText: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
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
  filterScroll: {
    marginBottom: spacing.sm,
  },
  filterScrollContent: {
    paddingHorizontal: spacing.xs,
    gap: 6,
    flexDirection: 'row',
  },
  controlChip: {
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
    borderRadius: layout.cardMargin,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  controlText: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.cardMargin,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipUnselected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  filterChipText: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
  },
  filterChipTextSelected: {
    color: colors.surface,
  },
  filterDivider: {
    width: 1,
    height: 20,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  countContainer: {
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  // Dark mode styles
  containerDark: {
    backgroundColor: darkColors.surfaceOverlay,
    borderTopColor: darkColors.border,
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
  legendDark: {
    borderTopColor: darkColors.border,
  },
  legendTextDark: {
    color: darkColors.textMuted,
  },
  legendEmptyDark: {
    backgroundColor: darkColors.border,
  },
  controlChipDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  controlTextDark: {
    color: darkColors.textMuted,
  },
  filterChipUnselectedDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
});
