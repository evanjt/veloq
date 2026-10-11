/**
 * A destructive action taken by holding, not tapping: the press fills the
 * button over {@link CONFIRM_HOLD_MS} and the action runs once the hold
 * completes.
 *
 * The `Pressable` owns the hold, so a press that ends early, slides off, or is
 * taken by a scroll cancels it and the fill drains. The touch-down plays no
 * haptic; the accepted hold plays one medium impact, the destructive accept.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/shared/app';
import * as haptics from '@/shared/ui/haptics';
import { CONFIRM_HOLD_MS } from '@/shared/ui/holdDurations';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { colors, colorWithOpacity, darkColors, layout, spacing, typography } from '@/theme';

export interface HoldButtonProps {
  label: string;
  /** Runs once, when the hold completes. */
  onConfirm: () => void;
  disabled?: boolean;
  testID?: string;
}

export function HoldButton({ label, onConfirm, disabled = false, testID }: HoldButtonProps) {
  const { isDark } = useTheme();
  const fill = useRef(new Animated.Value(0)).current;

  const drain = useCallback(() => {
    fill.stopAnimation();
    fill.setValue(0);
  }, [fill]);

  useEffect(() => drain, [drain]);

  const handlePressIn = useCallback(() => {
    Animated.timing(fill, {
      toValue: 1,
      duration: CONFIRM_HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [fill]);

  const handleLongPress = useCallback(() => {
    drain();
    haptics.medium();
    onConfirm();
  }, [drain, onConfirm]);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPressIn={handlePressIn}
      onLongPress={handleLongPress}
      delayLongPress={CONFIRM_HOLD_MS}
      onPressOut={drain}
      style={pressable()}
      android_ripple={pressRipple}
    >
      <Animated.View
        style={[
          styles.button,
          {
            borderColor: fill.interpolate({
              inputRange: [0, 1],
              outputRange: [colorWithOpacity(colors.error, 0.3), colors.error],
            }),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.fill,
            { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
        <Text style={[styles.label, isDark && styles.labelDark]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: layout.borderRadiusSm,
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.minTapTarget,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.error,
    opacity: 0.15,
  },
  label: {
    ...typography.bodyBold,
    color: colors.errorDeep,
  },
  labelDark: {
    color: darkColors.errorDeep,
  },
});
