/**
 * The icon-only form of `Button`.
 *
 * The press target is a square of at least `layout.minTapTarget` whatever the
 * glyph size, so a small icon is still a tap target. The label is required in
 * the props type because an icon has no text for a screen reader to fall back
 * on. Variants and press feedback are `Button`'s own.
 */

import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/shared/app';
import { layout } from '@/theme';

import { paint, pressedOpacity, ripple, type ButtonVariant } from './Button';

export interface IconButtonProps {
  /** What a screen reader announces. Required: an icon has no text of its own. */
  accessibilityLabel: string;
  onPress: () => void;
  /** The glyph. It sizes itself, the target does not follow it. */
  children: React.ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function IconButton({
  accessibilityLabel,
  onPress,
  children,
  variant = 'ghost',
  disabled = false,
  style,
  testID,
}: IconButtonProps) {
  const { isDark } = useTheme();
  const skin = paint(variant, isDark);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      android_ripple={disabled ? undefined : ripple}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: skin.backgroundColor,
          borderColor: skin.borderColor,
          borderWidth: skin.borderWidth,
          opacity: disabled ? 0.5 : pressedOpacity(pressed),
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusMd,
    minWidth: layout.minTapTarget,
    minHeight: layout.minTapTarget,
    overflow: 'hidden',
  },
});
