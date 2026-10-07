/**
 * One visual language for signal quality across the recording flow:
 * GPS accuracy in the timer header (micro), the pre-start readiness line
 * (line), and the sensor connection chip (chip). Severity maps to the
 * semantic palette; no surface invents its own colours.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { colors, colorWithOpacity, darkColors, layout, spacing, typography } from '@/theme';

export type SignalLevel = 'idle' | 'ok' | 'warn' | 'bad';

// The level is drawn as a mark and as text, so each tone is the deep one in the
// light theme and the light one in the dark theme, never the fill palette.
const LEVEL_COLORS: Record<'light' | 'dark', Record<SignalLevel, string>> = {
  light: {
    idle: colors.iconNeutral,
    ok: colors.successDeep,
    warn: colors.warningAmber,
    bad: colors.errorDeep,
  },
  dark: {
    idle: darkColors.iconNeutral,
    ok: darkColors.successDeep,
    warn: darkColors.warningAmber,
    bad: darkColors.errorDeep,
  },
};

export function signalColor(level: SignalLevel, isDark: boolean): string {
  return LEVEL_COLORS[isDark ? 'dark' : 'light'][level];
}

// The ground behind a level is the fill hue, which is a ground and not a mark.
// The deep green is 4.76:1 on the screen background before any tint, so the
// tint stays at 6% to keep the label above the 4.5:1 text bar.
export const SIGNAL_TINT_ALPHA = 0.06;

const LEVEL_TINTS: Record<'light' | 'dark', Record<SignalLevel, string>> = {
  light: {
    idle: colors.iconNeutral,
    ok: colors.success,
    warn: colors.warning,
    bad: colors.error,
  },
  dark: {
    idle: darkColors.iconNeutral,
    ok: darkColors.success,
    warn: darkColors.warning,
    bad: darkColors.error,
  },
};

export function signalTint(level: SignalLevel, isDark: boolean): string {
  return LEVEL_TINTS[isDark ? 'dark' : 'light'][level];
}

interface SignalStatusProps {
  level: SignalLevel;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label?: string;
  /** micro: inline icon+label. chip: tinted pill. line: full-width row. */
  variant?: 'micro' | 'chip' | 'line';
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Extra content after the label (kind icons, settings link, spinner). */
  children?: React.ReactNode;
  testID?: string | undefined;
}

export function SignalStatus({
  level,
  icon,
  label,
  variant = 'micro',
  onPress,
  accessibilityLabel,
  children,
  testID,
}: SignalStatusProps) {
  const { isDark } = useTheme();
  const color = signalColor(level, isDark);
  const tint = signalTint(level, isDark);
  const iconSize = variant === 'line' ? 18 : variant === 'chip' ? 13 : 14;

  const content = (
    <>
      <MaterialCommunityIcons name={icon} size={iconSize} color={color} />
      {label != null && (
        <Text
          style={[styles.label, variant === 'line' && styles.labelLine, { color }]}
          numberOfLines={variant === 'line' ? 2 : 1}
        >
          {label}
        </Text>
      )}
      {children}
    </>
  );

  const variantStyle =
    variant === 'line'
      ? [styles.line, { backgroundColor: colorWithOpacity(tint, SIGNAL_TINT_ALPHA) }]
      : variant === 'chip'
        ? [styles.chip, { backgroundColor: colorWithOpacity(tint, SIGNAL_TINT_ALPHA) }]
        : styles.micro;

  if (onPress) {
    return (
      <TouchableOpacity
        testID={testID}
        style={variantStyle}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        hitSlop={variant !== 'line' ? { top: 8, bottom: 8, left: 4, right: 4 } : undefined}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View testID={testID} style={variantStyle}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  micro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
  },
  label: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  labelLine: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontVariant: undefined,
  },
});
