import React, { useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  Animated,
  type AccessibilityActionEvent,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors, darkColors, rpeRamp, spacing, typography, layout } from '@/theme';

type RpeLabelKey = 'easy' | 'moderate' | 'hard' | 'veryHard' | 'max';

function getRpeLabelKey(value: number): RpeLabelKey {
  if (value <= 2) return 'easy';
  if (value <= 4) return 'moderate';
  if (value <= 6) return 'hard';
  if (value <= 8) return 'veryHard';
  return 'max';
}

function getRpeColor(value: number): string {
  return rpeRamp[Math.min(4, Math.floor((Math.max(1, value) - 1) / 2))];
}

const RPE_MIN = 1;
const RPE_MAX = 10;
const STEP_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];

function clampRpe(value: number): number {
  return Math.max(RPE_MIN, Math.min(RPE_MAX, value));
}

/** The value at `x` along a track `width` wide, snapped to a whole step. */
function rpeAt(x: number, width: number): number {
  return clampRpe(Math.round((x / width) * (RPE_MAX - RPE_MIN)) + RPE_MIN);
}

interface RpeSliderProps {
  value: number;
  onValueChange: (value: number) => void;
  textSecondary: string;
}

function RpeSliderInner({ value, onValueChange, textSecondary }: RpeSliderProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const trackWidth = useRef(0);
  const animValue = useRef(new Animated.Value(value)).current;
  const currentRef = useRef(value);

  // The thumb and fill take no touches, so the grant's locationX is always
  // measured on the track. Later positions come from the gesture's travel,
  // since a move's locationX is relative to whichever view is under the finger.
  const startX = useRef(0);

  useEffect(() => {
    animValue.setValue(value);
    currentRef.current = value;
  }, [animValue, value]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (trackWidth.current <= 0) return;
        startX.current = e.nativeEvent.locationX;
        const val = rpeAt(startX.current, trackWidth.current);
        animValue.setValue(val);
        currentRef.current = val;
      },
      onPanResponderMove: (_e, gesture) => {
        if (trackWidth.current <= 0) return;
        const val = rpeAt(startX.current + gesture.dx, trackWidth.current);
        animValue.setValue(val);
        currentRef.current = val;
      },
      onPanResponderRelease: () => {
        onValueChange(currentRef.current);
      },
    })
  ).current;

  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      const delta = e.nativeEvent.actionName === 'increment' ? 1 : -1;
      const next = clampRpe(value + delta);
      if (next !== value) onValueChange(next);
    },
    [value, onValueChange]
  );

  const handleLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    trackWidth.current = e.nativeEvent.layout.width;
  }, []);

  const band = t(`recording.rpeLabels.${getRpeLabelKey(value)}`);
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;

  return (
    <View testID="review-rpe" style={styles.rpeSection}>
      <View style={styles.rpeHeader}>
        <Text style={[styles.label, { color: textSecondary }]}>{t('recording.rpe', 'RPE')}</Text>
        <View style={styles.rpeReading}>
          <View style={[styles.rpeSwatch, { backgroundColor: getRpeColor(value) }]} />
          <Text style={[styles.rpeValue, { color: textPrimary }]}>
            {value} - {band}
          </Text>
        </View>
      </View>
      <Text style={[styles.rpeDescription, { color: textSecondary }]}>
        {t('recording.rpeDescription', '1 = effortless, 10 = maximum effort')}
      </Text>
      <View
        style={[
          styles.rpeTrack,
          { backgroundColor: isDark ? darkColors.surfaceElevated : colors.backgroundAlt },
        ]}
        onLayout={handleLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('recording.rpe', 'RPE')}
        accessibilityValue={{ min: RPE_MIN, max: RPE_MAX, now: value, text: `${value}, ${band}` }}
        accessibilityActions={STEP_ACTIONS}
        onAccessibilityAction={onAccessibilityAction}
        {...pan.panHandlers}
      >
        {/* Filled portion -- driven by Animated.Value for smooth drag */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.rpeFill,
            {
              width: animValue.interpolate({
                inputRange: [1, 10],
                outputRange: ['0%', '100%'],
              }),
              backgroundColor: getRpeColor(value),
            },
          ]}
        />
        {/* Thumb -- driven by Animated.Value for smooth drag */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.rpeThumb,
            {
              left: animValue.interpolate({
                inputRange: [1, 10],
                outputRange: ['0%', '100%'],
              }),
              backgroundColor: getRpeColor(value),
            },
          ]}
        />
      </View>
      {/* Scale labels */}
      <View style={styles.rpeScaleRow}>
        <Text style={[styles.rpeScaleLabel, { color: textSecondary }]}>1</Text>
        <Text style={[styles.rpeScaleLabel, { color: textSecondary }]}>5</Text>
        <Text style={[styles.rpeScaleLabel, { color: textSecondary }]}>10</Text>
      </View>
    </View>
  );
}

export const RpeSlider = React.memo(RpeSliderInner);

/** The thumb's diameter, which its left margin halves to centre it on the value. */
const RPE_THUMB = 28;

const styles = StyleSheet.create({
  rpeSection: {
    marginTop: spacing.lg,
  },
  rpeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xxs,
  },
  label: {
    ...typography.label,
  },
  rpeReading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  rpeSwatch: {
    width: spacing.smPlus,
    height: spacing.smPlus,
    borderRadius: layout.borderRadiusFull,
  },
  rpeValue: {
    ...typography.bodyBold,
  },
  rpeDescription: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  rpeTrack: {
    height: 32,
    borderRadius: layout.borderRadiusFull,
    position: 'relative',
    justifyContent: 'center',
  },
  rpeFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: layout.borderRadius,
    opacity: 0.3,
  },
  rpeThumb: {
    position: 'absolute',
    width: RPE_THUMB,
    height: RPE_THUMB,
    borderRadius: layout.borderRadiusFull,
    marginLeft: -RPE_THUMB / 2,
    top: 2,
  },
  rpeScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  rpeScaleLabel: {
    fontSize: typography.label.fontSize,
    fontVariant: ['tabular-nums'],
  },
});
