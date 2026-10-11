import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing } from '@/theme';
import { pressable, pressRipple } from './pressFeedback';

interface RowBaseProps {
  children: React.ReactNode;
  testID?: string | undefined;
  /** Greys a pressable row and stops its press. */
  disabled?: boolean | undefined;
  /**
   * A control at the trailing edge, such as an info button. On a pressable row it
   * sits beside the row's target rather than inside it, so a screen reader reaches
   * the row and the accessory as two controls.
   */
  accessory?: React.ReactNode;
}

export type RowProps =
  | (RowBaseProps & { onPress?: undefined; accessibilityLabel?: undefined })
  | (RowBaseProps & { onPress: () => void; accessibilityLabel: string });

export function Row({
  children,
  testID,
  onPress,
  accessibilityLabel,
  disabled,
  accessory,
}: RowProps) {
  const { isDark } = useTheme();

  if (!onPress) {
    return (
      <View testID={testID} style={styles.row}>
        {children}
        {accessory}
      </View>
    );
  }

  const target = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
      onPress={onPress}
      disabled={disabled}
      android_ripple={pressRipple}
      style={pressable([
        styles.row,
        accessory != null && styles.besideAccessory,
        disabled && styles.disabled,
      ])}
    >
      {children}
      <MaterialCommunityIcons
        testID="row-chevron"
        name="chevron-right"
        size={20}
        color={isDark ? darkColors.textSecondary : colors.textSecondary}
      />
    </Pressable>
  );

  if (accessory == null) return target;

  return (
    <View style={styles.withAccessory}>
      {target}
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: layout.minTapTarget,
  },
  besideAccessory: {
    flex: 1,
    paddingRight: 0,
  },
  withAccessory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  disabled: {
    opacity: 0.5,
  },
});
