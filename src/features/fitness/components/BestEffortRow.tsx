import React, { type ReactNode } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import { pressable, pressRipple } from '@/shared/ui';
import { colors, darkColors, spacing, typography, colorWithOpacity, ink } from '@/theme';

interface BestEffortRowProps {
  /** The window or distance the best is for. */
  label: string;
  value: string;
  /** A line under the value, such as the time a pace was held for. */
  secondary?: string | null;
  valueColor: string;
  isLast: boolean;
  /** Opens the activity from the whole row, which then carries a chevron. */
  onPress?: (() => void) | undefined;
  accessibilityLabel?: string | undefined;
  testID?: string | undefined;
  /** What the activity column shows: the activity's name, a link, or nothing. */
  children?: ReactNode;
}

/**
 * One best in a list of bests: label, value and the activity it came from.
 *
 * The label and value columns size from their content rather than from a fixed
 * width, so a long time at a large system text size stays on one line, and the
 * activity column takes what is left.
 */
export function BestEffortRow({
  label,
  value,
  secondary,
  valueColor,
  isLast,
  onPress,
  accessibilityLabel,
  testID,
  children,
}: BestEffortRowProps) {
  const { isDark } = useTheme();
  const rowStyle = [
    styles.row,
    !isLast && styles.rowBorder,
    !isLast && isDark && styles.rowBorderDark,
  ];

  const body = (
    <>
      <Text style={[styles.label, isDark && styles.labelDark]}>{label}</Text>
      <View style={styles.valueColumn} testID={testID ? `${testID}-value` : undefined}>
        <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
        {secondary ? (
          <Text style={[styles.secondary, isDark && styles.secondaryDark]}>{secondary}</Text>
        ) : null}
      </View>
      <View style={styles.activityColumn}>{children}</View>
      {onPress ? (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        android_ripple={pressRipple}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={pressable(rowStyle)}
        onPress={onPress}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View testID={testID} style={rowStyle}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colorWithOpacity(ink.black, 0.08),
  },
  rowBorderDark: {
    borderBottomColor: colorWithOpacity(ink.white, 0.08),
  },
  label: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textSecondary,
    minWidth: spacing.xxl,
    flexShrink: 1,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  valueColumn: {
    minWidth: spacing.xxl * 2,
    flexShrink: 0,
    alignItems: 'flex-end',
    marginLeft: spacing.sm,
  },
  value: {
    ...typography.body,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  secondary: {
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
    fontVariant: ['tabular-nums'],
  },
  secondaryDark: {
    color: darkColors.textSecondary,
  },
  activityColumn: {
    flex: 1,
    minWidth: 0,
    marginLeft: spacing.md,
  },
});
