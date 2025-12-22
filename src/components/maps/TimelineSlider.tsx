import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';
import { colors } from '@/theme';

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
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit'
  });
}

// Larger touch area for handles
const HANDLE_SIZE = 28;
const HANDLE_HIT_SLOP = 20;
const MIN_RANGE = 0.02;

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
}: TimelineSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const totalRange = maxDate.getTime() - minDate.getTime();

  // Convert dates to positions (0-1)
  const startPos = useSharedValue(
    totalRange > 0 ? (startDate.getTime() - minDate.getTime()) / totalRange : 0
  );
  const endPos = useSharedValue(
    totalRange > 0 ? (endDate.getTime() - minDate.getTime()) / totalRange : 1
  );

  // Track starting position for gestures
  const startPosAtGestureStart = useSharedValue(0);
  const endPosAtGestureStart = useSharedValue(0);

  // Calculate cached range positions
  const cachedRange = useMemo(() => {
    if (!cachedOldest || !cachedNewest || totalRange <= 0) {
      return { start: 0, end: 0, hasCache: false };
    }
    const start = Math.max(0, (cachedOldest.getTime() - minDate.getTime()) / totalRange);
    const end = Math.min(1, (cachedNewest.getTime() - minDate.getTime()) / totalRange);
    return { start, end, hasCache: true };
  }, [cachedOldest, cachedNewest, minDate, totalRange]);

  // Sync shared values when props change
  useEffect(() => {
    if (totalRange > 0) {
      startPos.value = (startDate.getTime() - minDate.getTime()) / totalRange;
      endPos.value = (endDate.getTime() - minDate.getTime()) / totalRange;
    }
  }, [startDate, endDate, minDate, totalRange]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const positionToDate = useCallback(
    (pos: number): Date => {
      const time = minDate.getTime() + pos * totalRange;
      return new Date(time);
    },
    [minDate, totalRange]
  );

  const updateDatesFromPositions = useCallback((startPosValue: number, endPosValue: number) => {
    const start = positionToDate(startPosValue);
    const end = positionToDate(endPosValue);
    onRangeChange(start, end);
  }, [positionToDate, onRangeChange]);

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
      runOnJS(updateDatesFromPositions)(startPos.value, endPos.value);
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
      runOnJS(updateDatesFromPositions)(startPos.value, endPos.value);
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

  // Cached range style (static, not animated)
  const cachedRangeStyle = useMemo(() => ({
    left: cachedRange.start * trackWidth,
    right: trackWidth - cachedRange.end * trackWidth,
  }), [cachedRange, trackWidth]);

  const presets = useMemo(() => [
    { label: '90d', days: 90 },
    { label: '6mo', days: 180 },
    { label: '1yr', days: 365 },
    { label: 'All', days: 365 * 10 },
  ], []);

  const selectPreset = useCallback(
    (days: number) => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      onRangeChange(start, now);
    },
    [onRangeChange]
  );

  return (
    <View style={styles.wrapper}>
      {/* Sync progress banner */}
      {syncProgress && (
        <View style={styles.syncBanner}>
          <Text style={styles.syncText}>
            {syncProgress.total > 0
              ? `Syncing ${syncProgress.completed}/${syncProgress.total} activities`
              : syncProgress.message || 'Syncing...'}
          </Text>
        </View>
      )}

      <View style={styles.container}>
        {/* Preset buttons */}
        <View style={styles.presets}>
          {presets.map((preset) => (
            <TouchableOpacity
              key={preset.label}
              style={styles.presetButton}
              onPress={() => selectPreset(preset.days)}
            >
              <Text style={styles.presetText}>{preset.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Slider track */}
        <View style={styles.sliderContainer} onLayout={onLayout}>
          {/* Base track - grey (no data) */}
          <View style={styles.track} />

          {/* Cached range - striped pattern */}
          {cachedRange.hasCache && trackWidth > 0 && (
            <View style={[styles.cachedRange, cachedRangeStyle]}>
              {/* Create stripe pattern with alternating views */}
              <View style={styles.stripeContainer}>
                {Array.from({ length: Math.ceil(trackWidth / 6) }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.stripe,
                      { backgroundColor: i % 2 === 0 ? colors.primary : 'rgba(255,255,255,0.8)' }
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
              <View style={styles.handle}>
                <View style={styles.handleInner} />
              </View>
            </Animated.View>
          </GestureDetector>

          {/* End handle */}
          <GestureDetector gesture={endGesture}>
            <Animated.View style={[styles.handleContainer, endHandleStyle]}>
              <View style={styles.handle}>
                <View style={styles.handleInner} />
              </View>
            </Animated.View>
          </GestureDetector>
        </View>

        {/* Date labels */}
        <View style={styles.labels}>
          <Text style={styles.dateLabel}>{formatShortDate(minDate)}</Text>
          <Text style={styles.countLabel}>
            {isLoading ? 'Loading...' : `${activityCount || 0} activities`}
          </Text>
          <Text style={styles.dateLabel}>{formatShortDate(maxDate)}</Text>
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendSelected]} />
            <Text style={styles.legendText}>Selected</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendCached]}>
              <View style={styles.legendStripe} />
            </View>
            <Text style={styles.legendText}>Cached</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendEmpty]} />
            <Text style={styles.legendText}>Not synced</Text>
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
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  presets: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  presetButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  sliderContainer: {
    height: 44,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
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
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  countLabel: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
    fontSize: 10,
    color: colors.textSecondary,
  },
});
