/**
 * Inline trim/expand panel for adjusting section bounds.
 * Full-width layout below the map, replaces the performance chart when active.
 *
 * Performance: slider handles and track run entirely on the UI thread via
 * Reanimated SharedValues at 60fps. Map updates are throttled to ~100ms
 * through the JS bridge to avoid overwhelming React re-renders.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { Pressable, View, StyleSheet, Text, LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native-paper';
import * as haptics from '@/shared/ui/haptics';
import { colors, darkColors, typography, spacing, layout, ink, slopToMinTapTarget } from '@/theme';
import { formatDistance } from '@/shared/format/format';
import { useMetricSystem, useTheme } from '@/shared/app';
import { Button, IconButton, ToggleButton, pressable, pressRipple } from '@/shared/ui';
import {
  levelRatio,
  precisionLevel,
  shouldMarkCrossing,
  type PrecisionLevel,
} from '@/features/routes/lib/trimPrecision';

const HANDLE_SIZE = 28;
const TRACK_HEIGHT = 4;
const MIN_HANDLE_GAP = 0.05;
const STEP_BUTTON_WIDTH = 30;
const STEP_BUTTON_HEIGHT = 28;

interface SectionTrimOverlayProps {
  pointCount: number;
  startIndex: number;
  endIndex: number;
  trimmedDistance: number;
  originalDistance: number;
  isSaving: boolean;
  canReset: boolean;
  isExpandMode: boolean;
  sectionStartInWindow?: number | undefined;
  sectionEndInWindow?: number | undefined;
  onStartChange: (index: number) => void;
  onEndChange: (index: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onReset: () => void;
  onToggleExpand: () => void;
}

export function SectionTrimOverlay({
  pointCount,
  startIndex,
  endIndex,
  trimmedDistance,
  originalDistance,
  isSaving,
  canReset,
  isExpandMode,
  sectionStartInWindow,
  sectionEndInWindow,
  onStartChange,
  onEndChange,
  onConfirm,
  onCancel,
  onReset,
  onToggleExpand,
}: SectionTrimOverlayProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const { isDark } = useTheme();
  const trackWidthSV = useSharedValue(0);

  const maxIndex = Math.max(pointCount - 1, 1);

  const hasWindowMarkers =
    isExpandMode && sectionStartInWindow != null && sectionEndInWindow != null;
  const sectionStartFraction = hasWindowMarkers ? (sectionStartInWindow ?? 0) / maxIndex : 0;
  const sectionEndFraction = hasWindowMarkers ? (sectionEndInWindow ?? maxIndex) / maxIndex : 1;

  // ── UI-thread state (SharedValues - 60fps, no bridge) ──
  const startFrac = useSharedValue(startIndex / maxIndex);
  const endFrac = useSharedValue(endIndex / maxIndex);
  const prevTransX = useSharedValue(0);
  const lastEmitTime = useSharedValue(0);
  const isDragging = useSharedValue(false);

  // Sync SharedValues when props change (e.g. step buttons, expand toggle)
  // Skip during active drag - the gesture owns the SharedValues then.
  useEffect(() => {
    if (!isDragging.value) startFrac.value = startIndex / maxIndex;
  }, [startIndex, maxIndex, startFrac, isDragging]);
  useEffect(() => {
    if (!isDragging.value) endFrac.value = endIndex / maxIndex;
  }, [endIndex, maxIndex, endFrac, isDragging]);

  const onTrackLayout = useCallback(
    (e: LayoutChangeEvent) => {
      trackWidthSV.value = e.nativeEvent.layout.width;
    },
    [trackWidthSV]
  );

  // The level the last update landed on, and when the last haptic fired. Held
  // on the UI thread so a crossing is found inside the worklet: hysteresis
  // makes a wobble on a threshold one crossing, and the floor keeps fast
  // back-and-forth drags to one JS hop per interval.
  const lastPrecision = useSharedValue<PrecisionLevel>('normal');
  const lastFireTime = useSharedValue(0);

  const fireHaptic = useCallback((level: PrecisionLevel) => {
    if (level === 'precision') {
      haptics.light();
    } else if (level === 'fine') {
      haptics.medium();
    }
  }, []);

  const resetPrecision = useCallback(() => {
    lastPrecision.value = 'normal';
  }, [lastPrecision]);

  // ── Step button handlers (JS thread - immediate) ──
  const nudgeStart = useCallback(
    (delta: number) => {
      const newIndex = Math.max(
        0,
        Math.min(startIndex + delta, endIndex - Math.ceil(maxIndex * MIN_HANDLE_GAP))
      );
      onStartChange(newIndex);
      haptics.light();
    },
    [startIndex, endIndex, maxIndex, onStartChange]
  );

  const nudgeEnd = useCallback(
    (delta: number) => {
      const newIndex = Math.max(
        startIndex + Math.ceil(maxIndex * MIN_HANDLE_GAP),
        Math.min(endIndex + delta, maxIndex)
      );
      onEndChange(newIndex);
      haptics.light();
    },
    [startIndex, endIndex, maxIndex, onEndChange]
  );

  // ── Start handle gesture ──
  // UI thread: handle + track at 60fps. Map updates throttled to ~150ms during drag.
  const startGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          'worklet';
          isDragging.value = true;
          prevTransX.value = 0;
          lastEmitTime.value = 0;
          lastFireTime.value = 0;
        })
        .onUpdate((e) => {
          'worklet';
          const level = precisionLevel(e.translationY, lastPrecision.value);
          const levelChanged = level !== lastPrecision.value;
          lastPrecision.value = level;
          const ratio = levelRatio(level);
          const tw = trackWidthSV.value;
          if (tw <= 0) return;
          const deltaX = (e.translationX - prevTransX.value) * ratio;
          prevTransX.value = e.translationX;
          const newFrac = Math.max(0, Math.min(startFrac.value + deltaX / tw, 1));
          if (newFrac < endFrac.value - MIN_HANDLE_GAP) {
            startFrac.value = newFrac;
            const now = Date.now();
            if (now - lastEmitTime.value >= 150) {
              lastEmitTime.value = now;
              runOnJS(onStartChange)(Math.round(newFrac * maxIndex));
            }
          }
          if (levelChanged) {
            const fireNow = Date.now();
            if (shouldMarkCrossing(fireNow, lastFireTime.value)) {
              lastFireTime.value = fireNow;
              runOnJS(fireHaptic)(level);
            }
          }
        })
        .onEnd(() => {
          'worklet';
          isDragging.value = false;
          runOnJS(onStartChange)(Math.round(startFrac.value * maxIndex));
          runOnJS(resetPrecision)();
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [
      maxIndex,
      onStartChange,
      startFrac,
      endFrac,
      prevTransX,
      trackWidthSV,
      lastEmitTime,
      isDragging,
      fireHaptic,
      lastPrecision,
      lastFireTime,
      resetPrecision,
    ]
  );

  // ── End handle gesture ──
  const endGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          'worklet';
          isDragging.value = true;
          prevTransX.value = 0;
          lastEmitTime.value = 0;
          lastFireTime.value = 0;
        })
        .onUpdate((e) => {
          'worklet';
          const level = precisionLevel(e.translationY, lastPrecision.value);
          const levelChanged = level !== lastPrecision.value;
          lastPrecision.value = level;
          const ratio = levelRatio(level);
          const tw = trackWidthSV.value;
          if (tw <= 0) return;
          const deltaX = (e.translationX - prevTransX.value) * ratio;
          prevTransX.value = e.translationX;
          const newFrac = Math.max(0, Math.min(endFrac.value + deltaX / tw, 1));
          if (newFrac > startFrac.value + MIN_HANDLE_GAP) {
            endFrac.value = newFrac;
            const now = Date.now();
            if (now - lastEmitTime.value >= 150) {
              lastEmitTime.value = now;
              runOnJS(onEndChange)(Math.round(newFrac * maxIndex));
            }
          }
          if (levelChanged) {
            const fireNow = Date.now();
            if (shouldMarkCrossing(fireNow, lastFireTime.value)) {
              lastFireTime.value = fireNow;
              runOnJS(fireHaptic)(level);
            }
          }
        })
        .onEnd(() => {
          'worklet';
          isDragging.value = false;
          runOnJS(onEndChange)(Math.round(endFrac.value * maxIndex));
          runOnJS(resetPrecision)();
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [
      maxIndex,
      onEndChange,
      startFrac,
      endFrac,
      prevTransX,
      trackWidthSV,
      lastEmitTime,
      isDragging,
      fireHaptic,
      lastPrecision,
      lastFireTime,
      resetPrecision,
    ]
  );

  // ── Animated styles (UI thread - instant) ──
  const startHandleStyle = useAnimatedStyle(() => ({
    left: startFrac.value * trackWidthSV.value - HANDLE_SIZE / 2,
  }));

  const endHandleStyle = useAnimatedStyle(() => ({
    left: endFrac.value * trackWidthSV.value - HANDLE_SIZE / 2,
  }));

  const trackActiveStyle = useAnimatedStyle(() => ({
    left: startFrac.value * trackWidthSV.value,
    width: (endFrac.value - startFrac.value) * trackWidthSV.value,
  }));

  // ── JS-thread derived values (for info display - updates at React render rate) ──
  const percentage =
    originalDistance > 0 ? Math.round((trimmedDistance / originalDistance) * 100) : 100;
  const isTrimmed = hasWindowMarkers
    ? startIndex !== sectionStartInWindow || endIndex !== sectionEndInWindow
    : startIndex > 0 || endIndex < maxIndex;

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View testID="section-trim-overlay" style={styles.container}>
      {/* Info row */}
      <View style={styles.infoRow}>
        <MaterialCommunityIcons
          name={isExpandMode ? 'arrow-expand-horizontal' : 'content-cut'}
          size={16}
          color={isTrimmed ? colors.primary : mutedColor}
        />
        {isSaving ? (
          <ActivityIndicator size={16} color={colors.primary} />
        ) : (
          <>
            <Text style={[styles.infoValue, { color: isTrimmed ? colors.primary : textColor }]}>
              {formatDistance(trimmedDistance, isMetric)}
            </Text>
            {isTrimmed && (
              <Text style={[styles.infoMuted, { color: mutedColor }]}>{percentage}%</Text>
            )}
          </>
        )}
        <Text style={[styles.infoMuted, { color: mutedColor }]}>
          {endIndex - startIndex + 1} / {t('sections.pointsCount', { count: pointCount })}
        </Text>
        <View style={{ flex: 1 }} />
        <ToggleButton
          testID="section-expand-toggle"
          label={isExpandMode ? t('sections.trimMode', 'Trim') : t('sections.expandMode', 'Expand')}
          selected={isExpandMode}
          onPress={onToggleExpand}
          disabled={isSaving}
        />
        {canReset && (
          <IconButton
            accessibilityLabel={t('sections.resetBounds')}
            onPress={onReset}
            disabled={isSaving}
          >
            <MaterialCommunityIcons name="refresh" size={16} color={colors.primary} />
          </IconButton>
        )}
      </View>

      {/* Full-width slider - handles + track driven by SharedValues (60fps) */}
      <View style={styles.sliderContainer} onLayout={onTrackLayout}>
        <View style={[styles.trackBackground, isDark && styles.trackBackgroundDark]} />
        {hasWindowMarkers && (
          <View
            style={[
              styles.trackSection,
              {
                left: `${sectionStartFraction * 100}%` as unknown as number,
                width: `${(sectionEndFraction - sectionStartFraction) * 100}%` as unknown as number,
              },
            ]}
          />
        )}
        <Animated.View style={[styles.trackActive, trackActiveStyle]} />
        <GestureDetector gesture={startGesture}>
          <Animated.View style={[styles.handle, startHandleStyle]}>
            <View style={styles.handleInner}>
              <View style={styles.handleBar} />
            </View>
          </Animated.View>
        </GestureDetector>
        <GestureDetector gesture={endGesture}>
          <Animated.View style={[styles.handle, endHandleStyle]}>
            <View style={styles.handleInner}>
              <View style={styles.handleBar} />
            </View>
          </Animated.View>
        </GestureDetector>
      </View>

      {/* Step buttons */}
      <View style={styles.stepRow}>
        <View style={styles.stepGroup}>
          <Pressable
            style={pressable([styles.stepButton, isDark && styles.stepButtonDark])}
            accessibilityRole="button"
            accessibilityLabel={t('sections.trimStartEarlier')}
            hitSlop={slopToMinTapTarget(STEP_BUTTON_HEIGHT, STEP_BUTTON_WIDTH)}
            onPress={() => nudgeStart(-1)}
            disabled={startIndex <= 0}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons name="chevron-left" size={16} color={colors.primary} />
          </Pressable>
          <Pressable
            style={pressable([styles.stepButton, isDark && styles.stepButtonDark])}
            accessibilityRole="button"
            accessibilityLabel={t('sections.trimStartLater')}
            hitSlop={slopToMinTapTarget(STEP_BUTTON_HEIGHT, STEP_BUTTON_WIDTH)}
            onPress={() => nudgeStart(1)}
            disabled={startIndex >= endIndex - Math.ceil(maxIndex * MIN_HANDLE_GAP)}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
          </Pressable>
        </View>
        <View style={styles.stepGroup}>
          <Pressable
            style={pressable([styles.stepButton, isDark && styles.stepButtonDark])}
            accessibilityRole="button"
            accessibilityLabel={t('sections.trimEndEarlier')}
            hitSlop={slopToMinTapTarget(STEP_BUTTON_HEIGHT, STEP_BUTTON_WIDTH)}
            onPress={() => nudgeEnd(-1)}
            disabled={endIndex <= startIndex + Math.ceil(maxIndex * MIN_HANDLE_GAP)}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons name="chevron-left" size={16} color={colors.primary} />
          </Pressable>
          <Pressable
            style={pressable([styles.stepButton, isDark && styles.stepButtonDark])}
            accessibilityRole="button"
            accessibilityLabel={t('sections.trimEndLater')}
            hitSlop={slopToMinTapTarget(STEP_BUTTON_HEIGHT, STEP_BUTTON_WIDTH)}
            onPress={() => nudgeEnd(1)}
            disabled={endIndex >= maxIndex}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {/* Precision hint */}
      <Text style={[styles.hint, { color: mutedColor }]}>
        {t('sections.trimPrecisionHint', 'Drag handle up or down for finer control')}
      </Text>

      {/* Action buttons */}
      <View style={styles.actions}>
        <Button
          testID="section-trim-cancel"
          variant="secondary"
          label={t('common.cancel')}
          onPress={onCancel}
          disabled={isSaving}
          style={styles.actionBtn}
          icon={<MaterialCommunityIcons name="close" size={18} color={colors.error} />}
        />
        <Button
          testID="section-trim-confirm"
          label={t('common.save')}
          onPress={onConfirm}
          disabled={!isTrimmed || isSaving}
          style={styles.actionBtn}
          icon={
            <MaterialCommunityIcons
              name="check"
              size={18}
              color={isTrimmed ? colors.textOnPrimary : mutedColor}
            />
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoValue: {
    ...typography.body,
    fontWeight: '600',
  },
  infoMuted: {
    ...typography.caption,
  },
  sliderContainer: {
    height: HANDLE_SIZE + 8,
    justifyContent: 'center',
    marginHorizontal: HANDLE_SIZE / 2,
  },
  trackBackground: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.border,
  },
  trackBackgroundDark: {
    backgroundColor: darkColors.border,
  },
  trackSection: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.primary + '30',
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
    borderRadius: layout.borderRadiusFull,
    backgroundColor: ink.white,
    borderWidth: 2,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handleBar: {
    width: 8,
    height: 2,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.primary,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepGroup: {
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  stepButton: {
    width: STEP_BUTTON_WIDTH,
    height: STEP_BUTTON_HEIGHT,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepButtonDark: {
    backgroundColor: colors.primary + '25',
  },
  hint: {
    ...typography.caption,
    textAlign: 'center',
    opacity: 0.7,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionBtn: {
    flex: 1,
  },
});
