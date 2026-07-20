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

import { colors, colorWithOpacity, layout, spacing, typography } from '@/theme';

export type SignalLevel = 'idle' | 'ok' | 'warn' | 'bad';

const LEVEL_COLORS: Record<SignalLevel, string> = {
  idle: colors.iconNeutral,
  ok: colors.success,
  warn: colors.warning,
  bad: colors.error,
};

export function signalColor(level: SignalLevel): string {
  return LEVEL_COLORS[level];
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
  testID?: string;
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
  const color = LEVEL_COLORS[level];
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
      ? [styles.line, { backgroundColor: colorWithOpacity(color, 0.1) }]
      : variant === 'chip'
        ? [styles.chip, { backgroundColor: colorWithOpacity(color, 0.12) }]
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
    gap: spacing.xs / 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: layout.borderRadiusSm,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
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
