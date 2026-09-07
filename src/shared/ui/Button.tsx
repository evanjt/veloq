/**
 * The app's button, and the only one.
 *
 * There were three answers in the tree and the product screens used none of
 * them: 113 files rendered a `TouchableOpacity`, 55 a `Pressable`, and 124
 * distinct `StyleSheet` keys matching `button` were the variant list nobody had
 * written down. `AnimatedButton` next door is a pressed-scale wrapper with no
 * visual, and Paper's `Button` reached one screen.
 *
 * **One visual on both platforms, platform feedback underneath.** The idiom
 * rule takes the platform for navigation chrome and sheets and keeps the app's
 * own for what the screens draw, and a button is the second. So the shape, the
 * ground and the type are the app's, and what differs is the press, an opacity
 * fade on iOS against a Material ripple on Android, and the tap target, which
 * takes each platform's own minimum through `layout.minTapTarget`.
 *
 * Tokens only. No hex literal and no `fontSize` number, which is what makes
 * converting the eighty-odd call sites mechanical rather than a redesign.
 */

import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Swaps the label for a spinner and refuses the press, without resizing. */
  loading?: boolean;
  /** Sits beside the label, inside the same tap target. */
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Android takes a ripple and no opacity, iOS the reverse. Passing `undefined`
 * for `android_ripple` on iOS is what keeps this one prop rather than two
 * components.
 */
const ripple = Platform.select({
  android: { borderless: false },
  default: undefined,
});

function pressedOpacity(pressed: boolean): number {
  if (Platform.OS === 'android') return 1;
  return pressed ? 0.7 : 1;
}

/** The ground, the border and the text, per variant and per theme. */
function paint(variant: ButtonVariant, isDark: boolean) {
  const palette = isDark ? darkColors : colors;
  switch (variant) {
    case 'secondary':
      return {
        backgroundColor: palette.surface,
        borderColor: palette.border,
        borderWidth: StyleSheet.hairlineWidth * 2,
        color: palette.textPrimary,
      };
    case 'ghost':
      return {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidth: 0,
        color: palette.primary,
      };
    case 'destructive':
      return {
        backgroundColor: palette.error,
        borderColor: palette.error,
        borderWidth: 0,
        color: colors.textOnDark,
      };
    case 'primary':
    default:
      return {
        backgroundColor: palette.primary,
        borderColor: palette.primary,
        borderWidth: 0,
        color: colors.textOnPrimary,
      };
  }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  style,
  testID,
}: ButtonProps) {
  const { isDark } = useTheme();
  const skin = paint(variant, isDark);
  const inert = disabled || loading;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      android_ripple={inert ? undefined : ripple}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        {
          backgroundColor: skin.backgroundColor,
          borderColor: skin.borderColor,
          borderWidth: skin.borderWidth,
          opacity: inert ? 0.5 : pressedOpacity(pressed),
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator testID={testID && `${testID}-spinner`} color={skin.color} size="small" />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text
            testID={testID && `${testID}-label`}
            numberOfLines={1}
            style={[size === 'sm' ? styles.labelSm : styles.labelMd, { color: skin.color }]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export interface ToggleButtonProps {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  size?: ButtonSize;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * One of a pair, for the control rows that pick between two things.
 *
 * The selected state is a heavier border as well as a colour, so it survives
 * greyscale and colour blindness, and it is on `accessibilityState.selected`
 * so a screen reader reads it at all. Colour alone is not a state.
 */
export function ToggleButton({
  label,
  onPress,
  selected = false,
  disabled = false,
  size = 'sm',
  style,
  testID,
}: ToggleButtonProps) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      android_ripple={disabled ? undefined : ripple}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        {
          backgroundColor: selected ? palette.primaryLight : palette.surface,
          borderColor: selected ? palette.primary : palette.border,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth * 2,
          opacity: disabled ? 0.5 : pressedOpacity(pressed),
        },
        style,
      ]}
    >
      <Text
        testID={testID && `${testID}-label`}
        numberOfLines={1}
        style={[
          size === 'sm' ? styles.labelSm : styles.labelMd,
          { color: selected ? palette.textPrimary : palette.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusMd,
    // The floor is the platform's own, so a short button is still a tap target.
    minHeight: layout.minTapTarget,
    overflow: 'hidden',
  },
  sm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  md: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  labelSm: typography.bodySmall,
  labelMd: typography.bodyBold,
});
