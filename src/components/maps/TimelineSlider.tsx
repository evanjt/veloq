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
  withSpring,
} from 'react-native-reanimated';
import { colors } from '@/theme';

interface SyncProgress {
  completed: number;
  total: number;
  message?: string;
}

interface TimelineSliderProps {
  /** Minimum date (oldest) */
  minDate: Date;
  /** Maximum date (newest) */
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
const HANDLE_HIT_SLOP = 20; // Extra touch area around handle
const MIN_RANGE = 0.02; // Minimum 2% range between handles

export function TimelineSlider({
  minDate,
  maxDate,
  startDate,
  endDate,
  onRangeChange,
  isLoading,
  activityCount,
  syncProgress,
}: TimelineSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [trackLeft, setTrackLeft] = useState(0);
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

  // Sync shared values when props change
  useEffect(() => {
    if (totalRange > 0) {
      startPos.value = (startDate.getTime() - minDate.getTime()) / totalRange;
      endPos.value = (endDate.getTime() - minDate.getTime()) / totalRange;
    }
  }, [startDate, endDate, minDate, totalRange]);

  // Handle layout to get track dimensions
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    setTrackLeft(e.nativeEvent.layout.x);
  }, []);

  // Convert position to date
  const positionToDate = useCallback(
    (pos: number): Date => {
      const time = minDate.getTime() + pos * totalRange;
      return new Date(time);
    },
    [minDate, totalRange]
  );

  // Update dates callback (called from JS thread)
  const updateDatesFromPositions = useCallback((startPosValue: number, endPosValue: number) => {
    const start = positionToDate(startPosValue);
    const end = positionToDate(endPosValue);
    onRangeChange(start, end);
  }, [positionToDate, onRangeChange]);

  // Start handle gesture - stores initial position and uses absolute movement
  const startGesture = Gesture.Pan()
    .hitSlop({ top: HANDLE_HIT_SLOP, bottom: HANDLE_HIT_SLOP, left: HANDLE_HIT_SLOP, right: HANDLE_HIT_SLOP })
    .onBegin(() => {
      // Store the position when gesture begins
      startPosAtGestureStart.value = startPos.value;
    })
    .onUpdate((e) => {
      if (trackWidth === 0) return;
      // Calculate new position based on stored start position + translation
      const delta = e.translationX / trackWidth;
      const newPos = Math.max(0, Math.min(endPos.value - MIN_RANGE, startPosAtGestureStart.value + delta));
      startPos.value = newPos;
    })
    .onEnd(() => {
      runOnJS(updateDatesFromPositions)(startPos.value, endPos.value);
    });

  // End handle gesture
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

  // Tap on track to move nearest handle
  const trackTapGesture = Gesture.Tap()
    .onEnd((e) => {
      if (trackWidth === 0) return;
      const tapPos = e.x / trackWidth;

      // Determine which handle is closer
      const distToStart = Math.abs(tapPos - startPos.value);
      const distToEnd = Math.abs(tapPos - endPos.value);

      if (distToStart < distToEnd) {
        // Move start handle (but don't pass end handle)
        const newPos = Math.max(0, Math.min(endPos.value - MIN_RANGE, tapPos));
        startPos.value = withSpring(newPos, { damping: 20, stiffness: 300 });
        runOnJS(updateDatesFromPositions)(newPos, endPos.value);
      } else {
        // Move end handle (but don't pass start handle)
        const newPos = Math.max(startPos.value + MIN_RANGE, Math.min(1, tapPos));
        endPos.value = withSpring(newPos, { damping: 20, stiffness: 300 });
        runOnJS(updateDatesFromPositions)(startPos.value, newPos);
      }
    });

  // Animated styles for handles - center the handle on the position
  const startHandleStyle = useAnimatedStyle(() => ({
    left: startPos.value * trackWidth - HANDLE_SIZE / 2,
  }));

  const endHandleStyle = useAnimatedStyle(() => ({
    left: endPos.value * trackWidth - HANDLE_SIZE / 2,
  }));

  // Animated style for selected range
  const rangeStyle = useAnimatedStyle(() => ({
    left: startPos.value * trackWidth,
    right: trackWidth - endPos.value * trackWidth,
  }));

  // Quick presets
  const presets = useMemo(() => {
    return [
      { label: '90d', days: 90 },
      { label: '6mo', days: 180 },
      { label: '1yr', days: 365 },
      { label: 'All', days: 365 * 10 }, // 10 years - will be clamped to actual data
    ];
  }, []);

  const selectPreset = useCallback(
    (days: number) => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - days);

      // Don't clamp - let onRangeChange trigger sync for the full range
      // This allows fetching older data if the user selects 1yr or All
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
        <GestureDetector gesture={trackTapGesture}>
          <View style={styles.sliderContainer} onLayout={onLayout}>
            <View style={styles.track} />

            {/* Selected range highlight */}
            <Animated.View style={[styles.selectedRange, rangeStyle]} />

            {/* Start handle - larger touch target */}
            <GestureDetector gesture={startGesture}>
              <Animated.View style={[styles.handleContainer, startHandleStyle]}>
                <View style={styles.handle}>
                  <View style={styles.handleInner} />
                </View>
              </Animated.View>
            </GestureDetector>

            {/* End handle - larger touch target */}
            <GestureDetector gesture={endGesture}>
              <Animated.View style={[styles.handleContainer, endHandleStyle]}>
                <View style={styles.handle}>
                  <View style={styles.handleInner} />
                </View>
              </Animated.View>
            </GestureDetector>
          </View>
        </GestureDetector>

        {/* Date labels */}
        <View style={styles.labels}>
          <Text style={styles.dateLabel}>{formatShortDate(startDate)}</Text>
          <Text style={styles.countLabel}>
            {isLoading ? 'Loading...' : `${activityCount || 0} activities`}
          </Text>
          <Text style={styles.dateLabel}>{formatShortDate(endDate)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    // Wrapper contains optional sync banner + main container
  },
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
    height: 44, // Taller for easier touch
    justifyContent: 'center',
    marginHorizontal: 14, // Account for handle overflow
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6, // Slightly thicker track
    backgroundColor: colors.border,
    borderRadius: 3,
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
    // The container provides the touch target
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
});
