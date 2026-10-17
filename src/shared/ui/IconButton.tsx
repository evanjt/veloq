/**
 * The icon-only form of `Button`.
 *
 * It is drawn in the button square of `controlHeight` whatever the glyph size,
 * or the small button's square where a row has no room for the full one,
 * and hit slop lifts that square to the platform minimum, so a small icon is
 * still a tap target without a large disc around it. The label is required in
 * the props type because an icon has no text for a screen reader to fall back
 * on. Variants and press feedback are `Button`'s own.
 */

import React from 'react';
import {
  Pressable,
  StyleSheet,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/shared/app';
import { controlHeight, layout, opacity, slopToMinTapTarget } from '@/theme';

import { paint, pressedOpacity, ripple, type ButtonVariant } from './Button';

export interface IconButtonProps {
  /** What a screen reader announces. Required: an icon has no text of its own. */
  accessibilityLabel: string;
  onPress?: () => void;
  onPressIn?: () => void;
  /** The glyph. It sizes itself, the target does not follow it. */
  children: React.ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityState?: AccessibilityState;
  /** A button by default; a press that opens a web page is a link. */
  accessibilityRole?: 'button' | 'link';
  /** Drawn in the small button's square, still lifted to the tap-target minimum. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
}

export function IconButton({
  accessibilityLabel,
  onPress,
  onPressIn,
  children,
  variant = 'ghost',
  disabled = false,
  accessibilityState,
  accessibilityRole = 'button',
  compact = false,
  style,
  testID,
}: IconButtonProps) {
  const { isDark } = useTheme();
  const skin = paint(variant, isDark);

  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled }}
      hitSlop={compact ? COMPACT_SLOP : ICON_SLOP}
      android_ripple={disabled ? undefined : ripple}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        {
          backgroundColor: skin.backgroundColor,
          borderColor: skin.borderColor,
          borderWidth: skin.borderWidth,
          opacity: disabled ? opacity.disabled : pressedOpacity(pressed),
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const ICON_SLOP = slopToMinTapTarget(controlHeight.button, controlHeight.button);
const COMPACT_SLOP = slopToMinTapTarget(controlHeight.buttonSm, controlHeight.buttonSm);

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusMd,
    minWidth: controlHeight.button,
    minHeight: controlHeight.button,
    overflow: 'hidden',
  },
  compact: {
    minWidth: controlHeight.buttonSm,
    minHeight: controlHeight.buttonSm,
  },
});
