/**
 * Overlay component for trimming section bounds.
 * Compact bottom bar design matching SectionCreationOverlay pattern.
 * Dual-handle range slider maps to polyline point indices.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  LayoutChangeEvent,
  Platform,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native-paper';
import { colors, typography, spacing, layout, shadows } from '@/theme';
import { formatDistance } from '@/lib';
import { useMetricSystem } from '@/hooks';

const HANDLE_SIZE = 28;
const TRACK_HEIGHT = 4;
const MIN_HANDLE_GAP = 0.05; // Minimum 5% gap between handles

interface SectionTrimOverlayProps {
  /** Total number of points in the polyline */
  pointCount: number;
  /** Current start index */
  startIndex: number;
  /** Current end index */
  endIndex: number;
  /** Trimmed distance in meters */
  trimmedDistance: number;
  /** Original section distance in meters */
  originalDistance: number;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Whether original bounds can be restored */
  canReset: boolean;
  /** Called when start index changes */
  onStartChange: (index: number) => void;
  /** Called when end index changes */
  onEndChange: (index: number) => void;
  /** Called to save the trim */
  onConfirm: () => void;
  /** Called to cancel trimming */
  onCancel: () => void;
  /** Called to reset to original bounds */
  onReset: () => void;
}

export function SectionTrimOverlay({
  pointCount,
  startIndex,
  endIndex,
  trimmedDistance,
  originalDistance,
  isSaving,
  canReset,
  onStartChange,
  onEndChange,
  onConfirm,
  onCancel,
  onReset,
}: SectionTrimOverlayProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isMetric = useMetricSystem();
  const [trackWidth, setTrackWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const maxIndex = pointCount - 1;

  // Convert indices to fractions
  const startFraction = maxIndex > 0 ? startIndex / maxIndex : 0;
  const endFraction = maxIndex > 0 ? endIndex / maxIndex : 1;

  // Shared values for gesture tracking
  const startX = useSharedValue(0);
  const endX = useSharedValue(0);

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  // Convert pixel position to index
  const posToIndex = useCallback(
    (x: number): number => {
      if (trackWidth <= 0 || maxIndex <= 0) return 0;
      const fraction = Math.max(0, Math.min(1, x / trackWidth));
      return Math.round(fraction * maxIndex);
    },
    [trackWidth, maxIndex]
  );

  // Start handle gesture
  const startGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          startX.value = startFraction * trackWidth;
        })
        .onUpdate((e) => {
          const newX = Math.max(0, Math.min(startX.value + e.translationX, trackWidth));
          const newFraction = newX / trackWidth;
          // Ensure min gap from end handle
          if (newFraction < endFraction - MIN_HANDLE_GAP) {
            const newIndex = Math.round(newFraction * maxIndex);
            runOnJS(onStartChange)(newIndex);
          }
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [startFraction, endFraction, trackWidth, maxIndex, onStartChange, startX]
  );

  // End handle gesture
  const endGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          endX.value = endFraction * trackWidth;
        })
        .onUpdate((e) => {
          const newX = Math.max(0, Math.min(endX.value + e.translationX, trackWidth));
          const newFraction = newX / trackWidth;
          // Ensure min gap from start handle
          if (newFraction > startFraction + MIN_HANDLE_GAP) {
            const newIndex = Math.round(newFraction * maxIndex);
            runOnJS(onEndChange)(newIndex);
          }
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [startFraction, endFraction, trackWidth, maxIndex, onEndChange, endX]
  );

  // Animated styles for handles
  const startHandleStyle = useAnimatedStyle(() => ({
    left: startFraction * trackWidth - HANDLE_SIZE / 2,
  }));

  const endHandleStyle = useAnimatedStyle(() => ({
    left: endFraction * trackWidth - HANDLE_SIZE / 2,
  }));

  // Percentage of original distance retained
  const percentage =
    originalDistance > 0 ? Math.round((trimmedDistance / originalDistance) * 100) : 100;
  const isTrimmed = startIndex > 0 || endIndex < maxIndex;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {/* Cancel button */}
        <TouchableOpacity
          style={[styles.iconButton, styles.cancelButton]}
          onPress={onCancel}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={isSaving}
        >
          <MaterialCommunityIcons name="close" size={22} color={colors.textOnDark} />
        </TouchableOpacity>

        {/* Center: status pill with slider */}
        <TouchableOpacity
          style={[styles.statusPill, expanded && styles.statusPillExpanded]}
          onPress={() => setExpanded(!expanded)}
          activeOpacity={0.9}
          disabled={isSaving}
        >
          {/* Distance display */}
          <View style={styles.statusRow}>
            {isSaving ? (
              <ActivityIndicator size={18} color={colors.primary} />
            ) : (
              <MaterialCommunityIcons
                name="arrow-expand-horizontal"
                size={18}
                color={isTrimmed ? colors.primary : colors.textSecondary}
              />
            )}
            <Text style={[styles.statusText, isTrimmed && { color: colors.primary }]}>
              {formatDistance(trimmedDistance, isMetric)}
            </Text>
            {isTrimmed && (
              <Text style={styles.percentText}>{percentage}%</Text>
            )}
            <MaterialCommunityIcons
              name={expanded ? 'chevron-down' : 'chevron-up'}
              size={16}
              color={colors.textSecondary}
            />
          </View>

          {/* Range slider */}
          <View style={styles.sliderContainer} onLayout={onTrackLayout}>
            {/* Background track */}
            <View style={styles.trackBackground} />

            {/* Active range */}
            {trackWidth > 0 && (
              <View
                style={[
                  styles.trackActive,
                  {
                    left: startFraction * trackWidth,
                    width: (endFraction - startFraction) * trackWidth,
                  },
                ]}
              />
            )}

            {/* Start handle */}
            {trackWidth > 0 && (
              <GestureDetector gesture={startGesture}>
                <Animated.View style={[styles.handle, startHandleStyle]}>
                  <View style={styles.handleInner}>
                    <View style={styles.handleBar} />
                  </View>
                </Animated.View>
              </GestureDetector>
            )}

            {/* End handle */}
            {trackWidth > 0 && (
              <GestureDetector gesture={endGesture}>
                <Animated.View style={[styles.handle, endHandleStyle]}>
                  <View style={styles.handleInner}>
                    <View style={styles.handleBar} />
                  </View>
                </Animated.View>
              </GestureDetector>
            )}
          </View>

          {/* Expanded details */}
          {expanded && (
            <View style={styles.expandedContent}>
              <View style={styles.detailRow}>
                <MaterialCommunityIcons
                  name="map-marker-multiple"
                  size={14}
                  color={colors.textSecondary}
                />
                <Text style={styles.detailText}>
                  {endIndex - startIndex + 1} / {pointCount} {t('sections.points', 'points')}
                </Text>
              </View>
              {originalDistance > 0 && isTrimmed && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons
                    name="ruler"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.detailText}>
                    {t('sections.originalDistance', 'Original')}: {formatDistance(originalDistance, isMetric)}
                  </Text>
                </View>
              )}
              {canReset && (
                <TouchableOpacity style={styles.resetRow} onPress={onReset}>
                  <MaterialCommunityIcons name="refresh" size={14} color={colors.primary} />
                  <Text style={styles.resetText}>{t('sections.resetBounds')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </TouchableOpacity>

        {/* Save button */}
        <TouchableOpacity
          style={[styles.iconButton, isTrimmed ? styles.confirmButton : styles.confirmButtonDisabled]}
          onPress={onConfirm}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={!isTrimmed || isSaving}
        >
          <MaterialCommunityIcons name="check" size={22} color={colors.textOnDark} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
  },
  cancelButton: {
    backgroundColor: colors.error,
  },
  confirmButton: {
    backgroundColor: colors.success,
  },
  confirmButtonDisabled: {
    backgroundColor: colors.gray500,
  },
  statusPill: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 22,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    ...shadows.elevated,
  },
  statusPillExpanded: {
    borderRadius: layout.borderRadius,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  statusText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  percentText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sliderContainer: {
    height: HANDLE_SIZE + 8,
    marginTop: spacing.xs,
    justifyContent: 'center',
  },
  trackBackground: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.border,
  },
  trackActive: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.primary,
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
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.elevated,
  },
  handleBar: {
    width: 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
  expandedContent: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  resetText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
});
