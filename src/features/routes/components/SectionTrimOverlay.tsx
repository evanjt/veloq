/**
 * Inline trim/expand panel for adjusting section bounds.
 * Full-width layout below the map, replaces the performance chart when active.
 *
 * Performance: slider handles and track run entirely on the UI thread via
 * Reanimated SharedValues at 60fps. Map updates are throttled to ~100ms
 * through the JS bridge to avoid overwhelming React re-renders.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { colors, darkColors, typography, spacing, layout } from '@/theme';
import { formatDistance } from '@/shared/format/format';
import { useMetricSystem, useTheme } from '@/shared/app';

const HANDLE_SIZE = 28;
const TRACK_HEIGHT = 4;
const MIN_HANDLE_GAP = 0.05;

interface SectionTrimOverlayProps {
  pointCount: number;
  startIndex: number;
  endIndex: number;
  trimmedDistance: number;
  originalDistance: number;
  isSaving: boolean;
  canReset: boolean;
  initiallyExpanded?: boolean;
  isExpandMode: boolean;
  sectionStartInWindow?: number;
  sectionEndInWindow?: number;
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

  // ── Precision helpers (worklets) ──
  const getPrecisionRatio = (dy: number): number => {
    'worklet';
    const absDy = Math.abs(dy);
    if (absDy < 20) return 1.0;
    if (absDy < 60) return 0.25;
    return 0.125;
  };

  const getPrecisionLevel = (dy: number): 'normal' | 'precision' | 'fine' => {
    'worklet';
    const absDy = Math.abs(dy);
    if (absDy < 20) return 'normal';
    if (absDy < 60) return 'precision';
    return 'fine';
  };

  const lastPrecisionRef = useRef<'normal' | 'precision' | 'fine'>('normal');
  const fireHapticOnThreshold = useCallback((level: 'normal' | 'precision' | 'fine') => {
    if (level !== lastPrecisionRef.current) {
      lastPrecisionRef.current = level;
      if (level === 'precision') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } else if (level === 'fine') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
    }
  }, []);

  const resetPrecision = useCallback(() => {
    lastPrecisionRef.current = 'normal';
  }, []);

  // ── Step button handlers (JS thread - immediate) ──
  const nudgeStart = useCallback(
    (delta: number) => {
      const newIndex = Math.max(
        0,
        Math.min(startIndex + delta, endIndex - Math.ceil(maxIndex * MIN_HANDLE_GAP))
      );
      onStartChange(newIndex);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
        })
        .onUpdate((e) => {
          'worklet';
          const ratio = getPrecisionRatio(e.translationY);
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
          runOnJS(fireHapticOnThreshold)(getPrecisionLevel(e.translationY));
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
      fireHapticOnThreshold,
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
        })
        .onUpdate((e) => {
          'worklet';
          const ratio = getPrecisionRatio(e.translationY);
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
          runOnJS(fireHapticOnThreshold)(getPrecisionLevel(e.translationY));
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
      fireHapticOnThreshold,
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
  const trackReady = trackWidthSV.value > 0 || true;

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
          {endIndex - startIndex + 1} / {pointCount} {t('sections.points', 'points')}
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          testID="section-expand-toggle"
          onPress={onToggleExpand}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[styles.expandToggle, isExpandMode && styles.expandToggleActive]}
          disabled={isSaving}
        >
          <MaterialCommunityIcons
            name={isExpandMode ? 'content-cut' : 'arrow-expand-horizontal'}
            size={14}
            color={isExpandMode ? colors.primary : mutedColor}
          />
          <Text
            style={[styles.expandToggleText, { color: isExpandMode ? colors.primary : mutedColor }]}
          >
            {isExpandMode ? t('sections.trimMode', 'Trim') : t('sections.expandMode', 'Expand')}
          </Text>
        </TouchableOpacity>
        {canReset && (
          <TouchableOpacity onPress={onReset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialCommunityIcons name="refresh" size={16} color={colors.primary} />
          </TouchableOpacity>
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
        {trackReady && (
          <GestureDetector gesture={startGesture}>
            <Animated.View style={[styles.handle, startHandleStyle]}>
              <View style={styles.handleInner}>
                <View style={styles.handleBar} />
              </View>
            </Animated.View>
          </GestureDetector>
        )}
        {trackReady && (
          <GestureDetector gesture={endGesture}>
            <Animated.View style={[styles.handle, endHandleStyle]}>
              <View style={styles.handleInner}>
                <View style={styles.handleBar} />
              </View>
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      {/* Step buttons */}
      <View style={styles.stepRow}>
        <View style={styles.stepGroup}>
          <TouchableOpacity
            style={[styles.stepButton, isDark && styles.stepButtonDark]}
            onPress={() => nudgeStart(-1)}
            disabled={startIndex <= 0}
          >
            <MaterialCommunityIcons name="chevron-left" size={16} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.stepButton, isDark && styles.stepButtonDark]}
            onPress={() => nudgeStart(1)}
            disabled={startIndex >= endIndex - Math.ceil(maxIndex * MIN_HANDLE_GAP)}
          >
            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.stepGroup}>
          <TouchableOpacity
            style={[styles.stepButton, isDark && styles.stepButtonDark]}
            onPress={() => nudgeEnd(-1)}
            disabled={endIndex <= startIndex + Math.ceil(maxIndex * MIN_HANDLE_GAP)}
          >
            <MaterialCommunityIcons name="chevron-left" size={16} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.stepButton, isDark && styles.stepButtonDark]}
            onPress={() => nudgeEnd(1)}
            disabled={endIndex >= maxIndex}
          >
            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Precision hint */}
      <Text style={[styles.hint, { color: mutedColor }]}>
        {t('sections.trimPrecisionHint', 'Drag handle up or down for finer control')}
      </Text>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          testID="section-trim-cancel"
          style={[styles.actionBtn, isDark ? styles.actionBtnDark : styles.actionBtnLight]}
          onPress={onCancel}
          activeOpacity={0.8}
          disabled={isSaving}
        >
          <MaterialCommunityIcons name="close" size={18} color={colors.error} />
          <Text style={[styles.actionLabel, { color: colors.error }]}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="section-trim-confirm"
          style={[
            styles.actionBtn,
            isTrimmed ? styles.confirmBtn : isDark ? styles.actionBtnDark : styles.actionBtnLight,
          ]}
          onPress={onConfirm}
          activeOpacity={0.8}
          disabled={!isTrimmed || isSaving}
        >
          <MaterialCommunityIcons
            name="check"
            size={18}
            color={isTrimmed ? colors.textOnPrimary : mutedColor}
          />
          <Text
            style={[styles.actionLabel, { color: isTrimmed ? colors.textOnPrimary : mutedColor }]}
          >
            {t('common.save')}
          </Text>
        </TouchableOpacity>
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
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expandToggleActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  expandToggleText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
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
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handleBar: {
    width: 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepGroup: {
    flexDirection: 'row',
    gap: 2,
  },
  stepButton: {
    width: 30,
    height: 28,
    borderRadius: 6,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 12,
    borderRadius: layout.borderRadiusSm,
  },
  actionBtnLight: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnDark: {
    backgroundColor: darkColors.surface,
    borderWidth: 1,
    borderColor: darkColors.border,
  },
  confirmBtn: {
    backgroundColor: colors.primary,
  },
  actionLabel: {
    ...typography.body,
    fontWeight: '600',
  },
});
