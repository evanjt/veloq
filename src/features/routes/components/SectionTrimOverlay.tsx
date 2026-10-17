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
import { useTranslation } from 'react-i18next';
import * as haptics from '@/shared/ui/haptics';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';
import {
  colorWithOpacity,
  opacity,
  colors,
  darkColors,
  iconSize,
  ink,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
  stroke,
  themedStyles,
  type Palette,
  themePalette,
} from '@/theme';
import { formatDistance } from '@/shared/format/format';
import {
  keepsEnoughPoints,
  stepTrimBound,
  trimMinGap,
  type TrimBound,
} from '@/shared/math/trimRange';
import { useMetricSystem, useTheme } from '@/shared/app';
import { Button, IconButton, pressable, pressRipple, Spinner, ToggleButton } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import {
  levelRatio,
  precisionLevel,
  shouldMarkCrossing,
  type PrecisionLevel,
} from '@/features/routes/lib/trimPrecision';

const HANDLE_SIZE = 28;
const TRACK_HEIGHT = 4;
const STEP_BUTTON_WIDTH = 30;
const STEP_BUTTON_HEIGHT = 28;

/** The parts of the slider drawn in the theme's primary. */
const primaryStyles = (palette: Palette) =>
  StyleSheet.create({
    trackSection: { backgroundColor: colorWithOpacity(palette.actionPrimary, opacity.tint3) },
    trackActive: { backgroundColor: palette.actionPrimary },
    handleInner: { borderColor: palette.actionPrimary },
    handleBar: { backgroundColor: palette.actionPrimary },
    stepButton: {
      width: STEP_BUTTON_WIDTH,
      height: STEP_BUTTON_HEIGHT,
      borderRadius: layout.borderRadiusSm,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colorWithOpacity(palette.actionPrimary, opacity.tint1),
    },
    stepButtonDark: { backgroundColor: colorWithOpacity(palette.actionPrimary, opacity.tint2) },
  });

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
  const palette = themePalette(isDark);
  const primary = themedStyles(primaryStyles, isDark);
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
  const fireHapticOnJS = useGestureCallback(fireHaptic);
  const resetPrecisionOnJS = useGestureCallback(resetPrecision);
  const startChangeOnJS = useGestureCallback(onStartChange);
  const endChangeOnJS = useGestureCallback(onEndChange);

  // ── Step button handlers (JS thread - immediate) ──
  const minGap = useMemo(() => trimMinGap(maxIndex), [maxIndex]);
  const minGapFrac = minGap / maxIndex;
  const stepped = (bound: TrimBound, delta: number) =>
    stepTrimBound(startIndex, endIndex, maxIndex, bound, delta, minGap);

  const nudgeStart = useCallback(
    (delta: number) => {
      onStartChange(stepTrimBound(startIndex, endIndex, maxIndex, 'start', delta, minGap));
      haptics.light();
    },
    [startIndex, endIndex, maxIndex, minGap, onStartChange]
  );

  const nudgeEnd = useCallback(
    (delta: number) => {
      onEndChange(stepTrimBound(startIndex, endIndex, maxIndex, 'end', delta, minGap));
      haptics.light();
    },
    [startIndex, endIndex, maxIndex, minGap, onEndChange]
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
          if (newFrac < endFrac.value - minGapFrac) {
            startFrac.value = newFrac;
            const now = Date.now();
            if (now - lastEmitTime.value >= 150) {
              lastEmitTime.value = now;
              runOnJS(startChangeOnJS)(Math.round(newFrac * maxIndex));
            }
          }
          if (levelChanged) {
            const fireNow = Date.now();
            if (shouldMarkCrossing(fireNow, lastFireTime.value)) {
              lastFireTime.value = fireNow;
              runOnJS(fireHapticOnJS)(level);
            }
          }
        })
        .onEnd(() => {
          'worklet';
          isDragging.value = false;
          runOnJS(startChangeOnJS)(Math.round(startFrac.value * maxIndex));
          runOnJS(resetPrecisionOnJS)();
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [
      maxIndex,
      minGapFrac,
      startChangeOnJS,
      startFrac,
      endFrac,
      prevTransX,
      trackWidthSV,
      lastEmitTime,
      isDragging,
      fireHapticOnJS,
      lastPrecision,
      lastFireTime,
      resetPrecisionOnJS,
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
          if (newFrac > startFrac.value + minGapFrac) {
            endFrac.value = newFrac;
            const now = Date.now();
            if (now - lastEmitTime.value >= 150) {
              lastEmitTime.value = now;
              runOnJS(endChangeOnJS)(Math.round(newFrac * maxIndex));
            }
          }
          if (levelChanged) {
            const fireNow = Date.now();
            if (shouldMarkCrossing(fireNow, lastFireTime.value)) {
              lastFireTime.value = fireNow;
              runOnJS(fireHapticOnJS)(level);
            }
          }
        })
        .onEnd(() => {
          'worklet';
          isDragging.value = false;
          runOnJS(endChangeOnJS)(Math.round(endFrac.value * maxIndex));
          runOnJS(resetPrecisionOnJS)();
        })
        .hitSlop({ top: 15, bottom: 15, left: 15, right: 15 }),
    [
      maxIndex,
      minGapFrac,
      endChangeOnJS,
      startFrac,
      endFrac,
      prevTransX,
      trackWidthSV,
      lastEmitTime,
      isDragging,
      fireHapticOnJS,
      lastPrecision,
      lastFireTime,
      resetPrecisionOnJS,
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
  const tooShort = !keepsEnoughPoints(startIndex, endIndex);
  const canSave = isTrimmed && !tooShort;

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const disabledInk = isDark ? darkColors.textDisabled : colors.textDisabled;
  const startEarlierOut = stepped('start', -1) === startIndex;
  const startLaterOut = stepped('start', 1) === startIndex;
  const endEarlierOut = stepped('end', -1) === endIndex;
  const endLaterOut = stepped('end', 1) === endIndex;
  const stepInk = (out: boolean) => (out ? disabledInk : palette.actionPrimary);
  const accentText = isDark ? darkColors.actionLink : colors.actionLink;

  return (
    <View testID="section-trim-overlay" style={styles.container}>
      {/* Info row */}
      <View style={styles.infoRow}>
        <Icon
          name={isExpandMode ? 'arrow-expand-horizontal' : 'content-cut'}
          size={iconSize.sm}
          color={isTrimmed ? palette.actionPrimary : mutedColor}
        />
        {isSaving ? (
          <Spinner />
        ) : (
          <>
            <Text style={[styles.infoValue, { color: isTrimmed ? accentText : textColor }]}>
              {formatDistance(trimmedDistance, isMetric)}
            </Text>
            {isTrimmed ? (
              <Text style={[styles.infoMuted, { color: mutedColor }]}>{percentage}%</Text>
            ) : null}
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
        {canReset ? (
          <IconButton
            accessibilityLabel={t('sections.resetBounds')}
            onPress={onReset}
            disabled={isSaving}
          >
            <Icon name="refresh" size={iconSize.sm} color={palette.actionPrimary} />
          </IconButton>
        ) : null}
      </View>

      {/* Full-width slider - handles + track driven by SharedValues (60fps) */}
      <View style={styles.sliderContainer} onLayout={onTrackLayout}>
        <View style={[styles.trackBackground, isDark && styles.trackBackgroundDark]} />
        {hasWindowMarkers ? (
          <View
            style={[
              styles.trackSection,
              primary.trackSection,
              {
                left: `${sectionStartFraction * 100}%` as unknown as number,
                width: `${(sectionEndFraction - sectionStartFraction) * 100}%` as unknown as number,
              },
            ]}
          />
        ) : null}
        <Animated.View style={[styles.trackActive, primary.trackActive, trackActiveStyle]} />
        <GestureDetector gesture={startGesture}>
          <Animated.View style={[styles.handle, startHandleStyle]}>
            <View style={[styles.handleInner, primary.handleInner]}>
              <View style={[styles.handleBar, primary.handleBar]} />
            </View>
          </Animated.View>
        </GestureDetector>
        <GestureDetector gesture={endGesture}>
          <Animated.View style={[styles.handle, endHandleStyle]}>
            <View style={[styles.handleInner, primary.handleInner]}>
              <View style={[styles.handleBar, primary.handleBar]} />
            </View>
          </Animated.View>
        </GestureDetector>
      </View>

      {/* Step buttons */}
      <View style={styles.stepRow}>
        <View style={styles.stepGroup}>
          <Pressable
            style={pressable([primary.stepButton, isDark && primary.stepButtonDark])}
            accessibilityRole="button"
            accessibilityLabel={t('sections.trimStartEarlier')}
            hitSlop={slopToMinTapTarget(STEP_BUTTON_HEIGHT, STEP_BUTTON_WIDTH)}
            onPress={() => nudgeStart(-1)}
            disabled={startEarlierOut}
            android_ripple={pressRipple}
          >
            <Icon name="chevron-left" size={iconSize.sm} color={stepInk(startEarlierOut)} />
          </Pressable>
          <Pressable
            style={pressable([primary.stepButton, isDark && primary.stepButtonDark])}
            accessibilityRole="button"
            accessibilityLabel={t('sections.trimStartLater')}
            hitSlop={slopToMinTapTarget(STEP_BUTTON_HEIGHT, STEP_BUTTON_WIDTH)}
            onPress={() => nudgeStart(1)}
            disabled={startLaterOut}
            android_ripple={pressRipple}
          >
            <Icon name="chevron-right" size={iconSize.sm} color={stepInk(startLaterOut)} />
          </Pressable>
        </View>
        <View style={styles.stepGroup}>
          <Pressable
            style={pressable([primary.stepButton, isDark && primary.stepButtonDark])}
            accessibilityRole="button"
            accessibilityLabel={t('sections.trimEndEarlier')}
            hitSlop={slopToMinTapTarget(STEP_BUTTON_HEIGHT, STEP_BUTTON_WIDTH)}
            onPress={() => nudgeEnd(-1)}
            disabled={endEarlierOut}
            android_ripple={pressRipple}
          >
            <Icon name="chevron-left" size={iconSize.sm} color={stepInk(endEarlierOut)} />
          </Pressable>
          <Pressable
            style={pressable([primary.stepButton, isDark && primary.stepButtonDark])}
            accessibilityRole="button"
            accessibilityLabel={t('sections.trimEndLater')}
            hitSlop={slopToMinTapTarget(STEP_BUTTON_HEIGHT, STEP_BUTTON_WIDTH)}
            onPress={() => nudgeEnd(1)}
            disabled={endLaterOut}
            android_ripple={pressRipple}
          >
            <Icon name="chevron-right" size={iconSize.sm} color={stepInk(endLaterOut)} />
          </Pressable>
        </View>
      </View>

      {/* Precision hint */}
      <Text style={[styles.hint, { color: mutedColor }]}>
        {t('sections.trimPrecisionHint', 'Drag handle up or down for finer control')}
      </Text>

      {tooShort ? (
        <Text
          testID="section-trim-too-short"
          style={[styles.reason, { color: isDark ? darkColors.errorText : colors.errorText }]}
        >
          {t('sections.trimTooShort', 'Section must have at least 5 points')}
        </Text>
      ) : null}

      {/* Action buttons */}
      <View style={styles.actions}>
        <Button
          testID="section-trim-cancel"
          variant="secondary"
          label={t('common.cancel')}
          onPress={onCancel}
          disabled={isSaving}
          style={styles.actionBtn}
          icon="close"
        />
        <Button
          testID="section-trim-confirm"
          label={t('common.save')}
          onPress={onConfirm}
          disabled={!canSave || isSaving}
          style={styles.actionBtn}
          icon="check"
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
    ...typography.bodyBold,
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
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.border,
  },
  trackBackgroundDark: {
    backgroundColor: darkColors.border,
  },
  trackSection: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: layout.borderRadiusFull,
  },
  trackActive: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: layout.borderRadiusFull,
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
    borderWidth: stroke.two,
    justifyContent: 'center',
    alignItems: 'center',
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
  },
  stepGroup: {
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  hint: {
    ...typography.caption,
    textAlign: 'center',
  },
  reason: {
    ...typography.caption,
    textAlign: 'center',
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
