/**
 * The app's button, and the only one.
 *
 * There were three answers in the tree and the product screens used none of
 * them: 113 files rendered a `TouchableOpacity`, 55 a `Pressable`, and 124
 * distinct `StyleSheet` keys matching `button` were the variant list nobody had
 * written down.
 *
 * **One visual on both platforms, platform feedback underneath.** The idiom
 * rule takes the platform for navigation chrome and sheets and keeps the app's
 * own for what the screens draw, and a button is the second. So the shape, the
 * ground and the type are the app's, and what differs is the press, an opacity
 * fade on iOS against a Material ripple on Android, and the tap target, which
 * takes each platform's own minimum through `layout.minTapTarget`.
 *
 * **Drawn compact, reached through slop.** A button is drawn at its rung of
 * `controlHeight` and the rest of the platform minimum is hit slop, so the
 * target holds and a button bar does not read as a row of boxes.
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
import * as haptics from '@/shared/ui/haptics';
import {
  colorWithOpacity,
  colors,
  controlHeight,
  darkColors,
  ink as inkTone,
  layout,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /**
   * The press opens a confirmation. A destructive button then fires no haptic of its own: the
   * confirm's accept does, once.
   */
  opensConfirm?: boolean;
  /** Swaps the label for a spinner and refuses the press, without resizing. */
  loading?: boolean;
  /** The button opens and closes something, and this is whether it is open. */
  expanded?: boolean;
  /** Sits beside the label, inside the same tap target. */
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  labelTestID?: string;
}

/**
 * Android takes a ripple and no opacity, iOS the reverse. Passing `undefined`
 * for `android_ripple` on iOS is what keeps this one prop rather than two
 * components.
 */
export const ripple = Platform.select({
  android: { borderless: false },
  default: undefined,
});

export function pressedOpacity(pressed: boolean): number {
  if (Platform.OS === 'android') return 1;
  return pressed ? 0.7 : 1;
}

/** The ground, the border and the text, per variant and per theme. */
export function paint(variant: ButtonVariant, isDark: boolean) {
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
        // A label with no ground of its own is text on the page, so it takes the accent's text role.
        color: palette.linkTeal,
      };
    case 'destructive':
      return {
        // White clears the bar only on the deeper red. The dark red is light, so it takes dark ink.
        backgroundColor: isDark ? palette.error : colors.errorDeep,
        borderColor: isDark ? palette.error : colors.errorDeep,
        borderWidth: 0,
        color: isDark ? colors.textOnPrimary : colors.textOnDark,
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
  opensConfirm = false,
  expanded,
  icon,
  style,
  testID,
  labelTestID,
}: ButtonProps) {
  const { isDark } = useTheme();
  const skin = paint(variant, isDark);
  const inert = disabled || loading;
  // A destructive button acts on press, so it carries the weight of the act itself.
  const handlePress =
    variant === 'destructive' && !opensConfirm
      ? () => {
          haptics.medium();
          onPress();
        }
      : onPress;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled,
        busy: loading,
        ...(expanded !== undefined && { expanded }),
      }}
      hitSlop={BUTTON_SLOP[size]}
      android_ripple={inert ? undefined : ripple}
      disabled={inert}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        {
          backgroundColor: skin.backgroundColor,
          borderColor: skin.borderColor,
          borderWidth: skin.borderWidth,
          opacity: inert ? opacity.disabled : pressedOpacity(pressed),
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
            testID={labelTestID ?? (testID && `${testID}-label`)}
            style={[
              size === 'sm' ? styles.labelSm : styles.labelMd,
              styles.label,
              { color: skin.color },
            ]}
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
  icon?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  size?: ButtonSize;
  /** The ground when selected, for an option that stands for a sport or a series. */
  fill?: string;
  /** The label on `fill`, which has to clear 4.5:1 on it. */
  ink?: string;
  /** A number after the label, drawn smaller in the label's ink, such as how many items the option holds. */
  count?: number;
  /** What a tap does, when the label alone does not say it. Defaults to the label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The app's selector chip: one option among a few, the chosen one filled.
 *
 * Every selector draws this one chip, whether it sits in a filter row, a
 * section page's plot switch or a settings row, so a row of them reads as one
 * control. The chosen chip is a solid fill against a faint wash, a step in
 * lightness as well as in hue, so the state survives greyscale and colour
 * blindness, and it is on `accessibilityState.selected` so a screen reader
 * reads it at all. Colour alone is not a state.
 */
export function ToggleButton({
  label,
  onPress,
  icon,
  selected = false,
  disabled = false,
  size = 'sm',
  fill,
  ink,
  count,
  accessibilityLabel,
  style,
  testID,
}: ToggleButtonProps) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const labelInk = selected ? (ink ?? colors.textOnPrimary) : palette.textSecondary;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      hitSlop={CHIP_SLOP[size]}
      android_ripple={disabled ? undefined : ripple}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        size === 'sm' ? styles.chipSm : styles.chipMd,
        {
          backgroundColor: selected ? (fill ?? palette.primary) : chipWash(isDark),
          opacity: disabled ? opacity.disabled : pressedOpacity(pressed),
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {icon}
        <Text
          testID={testID && `${testID}-label`}
          numberOfLines={1}
          style={[styles.chipLabel, { color: labelInk }]}
        >
          {label}
          {count !== undefined && (
            <Text
              testID={testID && `${testID}-count`}
              style={[styles.chipCount, { color: labelInk }]}
            >
              {' '}
              {count}
            </Text>
          )}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The ground of a chip that is not chosen, under a `textSecondary` label. In
 * dark, white at 0.15 over `surfaceCard` lifted it until the label read
 * 3.78:1; at 0.08 the label reads 4.76:1 on the lightest dark surface.
 */
function chipWash(isDark: boolean): string {
  return colorWithOpacity(isDark ? inkTone.white : inkTone.black, 0.08);
}

export interface ToggleButtonRowProps<T extends string> {
  options: readonly { value: T; label: string; testID?: string }[];
  value: T;
  onValueChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}

/** A row of `ToggleButton`, one per option, with exactly one selected. */
export function ToggleButtonRow<T extends string>({
  options,
  value,
  onValueChange,
  style,
}: ToggleButtonRowProps<T>) {
  return (
    <View style={[styles.toggleRow, style]}>
      {options.map((option) => (
        <ToggleButton
          key={option.value}
          {...(option.testID && { testID: option.testID })}
          label={option.label}
          selected={option.value === value}
          onPress={() => onValueChange(option.value)}
          style={styles.toggleCell}
        />
      ))}
    </View>
  );
}

const BUTTON_HEIGHT = {
  sm: controlHeight.buttonSm,
  md: controlHeight.button,
} as const;
const CHIP_HEIGHT = {
  sm: controlHeight.chip,
  md: controlHeight.button,
} as const;
const BUTTON_SLOP = {
  sm: slopToMinTapTarget(BUTTON_HEIGHT.sm),
  md: slopToMinTapTarget(BUTTON_HEIGHT.md),
} as const;
const CHIP_SLOP = {
  sm: slopToMinTapTarget(CHIP_HEIGHT.sm),
  md: slopToMinTapTarget(CHIP_HEIGHT.md),
} as const;

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  toggleCell: {
    flex: 1,
  },
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
  sm: {
    minHeight: BUTTON_HEIGHT.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  md: {
    minHeight: BUTTON_HEIGHT.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  // A label wraps and the button grows at large text sizes rather than cutting
  // its words; shrinking inside the row is what lets it wrap beside an icon.
  label: {
    flexShrink: 1,
    textAlign: 'center',
  },
  labelSm: typography.bodySmall,
  labelMd: typography.bodyBold,
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
    gap: spacing.xs,
  },
  chipSm: {
    minHeight: CHIP_HEIGHT.sm,
    paddingHorizontal: spacing.smPlus,
  },
  chipMd: {
    minHeight: CHIP_HEIGHT.md,
    paddingHorizontal: spacing.md,
  },
  chipLabel: {
    ...typography.bodyCompact,
    fontWeight: '600',
  },
  chipCount: {
    ...typography.caption,
  },
});
