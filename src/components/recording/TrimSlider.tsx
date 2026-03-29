/**
 * Recording trim slider — dual-handle range slider for trimming GPS recordings.
 * Uses react-native-gesture-handler for reliable pan handling that doesn't
 * conflict with Android's edge-swipe back gesture.
 * Design cues from SectionTrimOverlay: pill container, round handles, hit slop.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, brand, shadows } from '@/theme';
import { formatDuration } from '@/lib';

const HANDLE_SIZE = 28;
const TRACK_HEIGHT = 4;
const MIN_HANDLE_GAP = 0.05;

interface TrimSliderProps {
  totalDuration: number;
  totalPoints: number;
  onTrimChange: (startIdx: number, endIdx: number) => void;
  startIdx: number;
  endIdx: number;
}

export function TrimSlider({
  totalDuration,
  totalPoints,
  onTrimChange,
  startIdx,
  endIdx,
}: TrimSliderProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  const maxIndex = totalPoints - 1;
  const startFraction = maxIndex > 0 ? startIdx / maxIndex : 0;
  const endFraction = maxIndex > 0 ? endIdx / maxIndex : 1;

  const startTime = totalDuration * startFraction;
  const endTime = totalDuration * endFraction;
  const isTrimmed = startIdx > 0 || endIdx < maxIndex;

  const startX = useSharedValue(0);
  const endX = useSharedValue(0);

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const startGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          startX.value = startFraction * trackWidth;
        })
        .onUpdate((e) => {
          const newX = Math.max(0, Math.min(startX.value + e.translationX, trackWidth));
          const newFraction = newX / trackWidth;
          if (newFraction < endFraction - MIN_HANDLE_GAP) {
            const newIndex = Math.round(newFraction * maxIndex);
            runOnJS(onTrimChange)(newIndex, endIdx);
          }
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [startFraction, endFraction, trackWidth, maxIndex, onTrimChange, endIdx, startX]
  );

  const endGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          endX.value = endFraction * trackWidth;
        })
        .onUpdate((e) => {
          const newX = Math.max(0, Math.min(endX.value + e.translationX, trackWidth));
          const newFraction = newX / trackWidth;
          if (newFraction > startFraction + MIN_HANDLE_GAP) {
            const newIndex = Math.round(newFraction * maxIndex);
            runOnJS(onTrimChange)(startIdx, newIndex);
          }
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [startFraction, endFraction, trackWidth, maxIndex, onTrimChange, startIdx, endX]
  );

  const startHandleStyle = useAnimatedStyle(() => ({
    left: startFraction * trackWidth - HANDLE_SIZE / 2,
  }));

  const endHandleStyle = useAnimatedStyle(() => ({
    left: endFraction * trackWidth - HANDLE_SIZE / 2,
  }));

  const pillBg = isDark ? 'rgba(30, 30, 30, 0.92)' : 'rgba(255, 255, 255, 0.95)';
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={[styles.pill, { backgroundColor: pillBg }]} testID="review-trim-slider">
      {/* Title + time labels */}
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: textPrimary }]}>
          {t('recording.trimActivity', 'Trim Activity')}
        </Text>
        <Text style={[styles.timeRange, { color: isTrimmed ? brand.teal : textSecondary }]}>
          {formatDuration(startTime)} — {formatDuration(endTime)}
        </Text>
      </View>

      {/* Slider track */}
      <View style={styles.sliderContainer} onLayout={onTrackLayout}>
        {/* Background track */}
        <View style={[styles.trackBg, { backgroundColor: isDark ? '#333' : colors.border }]} />

        {/* Active range */}
        {trackWidth > 0 && (
          <View
            style={[
              styles.trackActive,
              {
                left: startFraction * trackWidth,
                width: (endFraction - startFraction) * trackWidth,
                backgroundColor: brand.teal,
              },
            ]}
          />
        )}

        {/* Start handle */}
        {trackWidth > 0 && (
          <GestureDetector gesture={startGesture}>
            <Animated.View style={[styles.handle, startHandleStyle]}>
              <View style={[styles.handleInner, { borderColor: brand.teal }]}>
                <View style={[styles.handleBar, { backgroundColor: brand.teal }]} />
              </View>
            </Animated.View>
          </GestureDetector>
        )}

        {/* End handle */}
        {trackWidth > 0 && (
          <GestureDetector gesture={endGesture}>
            <Animated.View style={[styles.handle, endHandleStyle]}>
              <View style={[styles.handleInner, { borderColor: brand.teal }]}>
                <View style={[styles.handleBar, { backgroundColor: brand.teal }]} />
              </View>
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm + 4,
    ...shadows.elevated,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
  },
  timeRange: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
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
  },
  handleInner: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.elevated,
  },
  handleBar: {
    width: 8,
    height: 2,
    borderRadius: 1,
  },
});
