/**
 * One visual language for signal quality across the recording flow:
 * GPS accuracy in the timer header (micro), the pre-start readiness line
 * (line), and the sensor connection chip (chip). Severity maps to the
 * semantic palette; no surface invents its own colours.
 */

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { absentLabel } from '@/shared/format/absent';
import { colors, darkColors, iconSize, layout, spacing, stroke, typography } from '@/theme';
import { noticePalette, type NoticePalette, type PaletteTone } from './noticePalette';
import { pressable, pressRipple } from './pressFeedback';

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

const LEVEL_TONES: Record<SignalLevel, PaletteTone> = {
  idle: 'neutral',
  ok: 'success',
  warn: 'warning',
  bad: 'error',
};

/**
 * The ground behind a level is the notice palette's ground for its tone, so a
 * chip or a line and a notice of one tone show one tint, and each mark is
 * measured on it in `TINT_GROUNDS`. Idle is the surface, edged.
 */
export function signalGround(level: SignalLevel, isDark: boolean): NoticePalette {
  return noticePalette(LEVEL_TONES[level], isDark);
}

/**
 * The corner radius of the line variant. A row that wraps the line with a
 * control beside it clips to this radius so the tint reads as one shape.
 */
export const SIGNAL_LINE_RADIUS = layout.borderRadiusMd;

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
  const { t } = useTranslation();
  const color = signalColor(level, isDark);
  const ground = signalGround(level, isDark);
  const glyphSize =
    variant === 'line' ? iconSize.md : variant === 'chip' ? iconSize.xs : iconSize.sm;

  const content = (
    <>
      <MaterialCommunityIcons name={icon} size={glyphSize} color={color} />
      {label != null && (
        <Text
          style={[styles.label, variant === 'line' && styles.labelLine, { color }]}
          numberOfLines={variant === 'line' ? 2 : 1}
          accessibilityLabel={absentLabel(label, t)}
        >
          {label}
        </Text>
      )}
      {children}
    </>
  );

  const groundStyle = [
    { backgroundColor: ground.bg },
    ground.border !== undefined && { borderWidth: stroke.hairline, borderColor: ground.border },
  ];
  const variantStyle =
    variant === 'line'
      ? [styles.line, ...groundStyle]
      : variant === 'chip'
        ? [styles.chip, ...groundStyle]
        : styles.micro;

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        style={pressable(variantStyle)}
        android_ripple={pressRipple}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        hitSlop={variant !== 'line' ? { top: 8, bottom: 8, left: 4, right: 4 } : undefined}
      >
        {content}
      </Pressable>
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
    borderRadius: layout.borderRadiusFull,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: SIGNAL_LINE_RADIUS,
  },
  label: {
    ...typography.badge,
    fontVariant: ['tabular-nums'],
  },
  labelLine: {
    ...typography.bodySmallBold,
    flex: 1,
    fontVariant: undefined,
  },
});
