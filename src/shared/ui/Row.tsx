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
}

export type RowProps =
  | (RowBaseProps & { onPress?: undefined; accessibilityLabel?: undefined })
  | (RowBaseProps & { onPress: () => void; accessibilityLabel: string });

export function Row({ children, testID, onPress, accessibilityLabel, disabled }: RowProps) {
  const { isDark } = useTheme();

  if (!onPress) {
    return (
      <View testID={testID} style={styles.row}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
      onPress={onPress}
      disabled={disabled}
      android_ripple={pressRipple}
      style={pressable(disabled ? [styles.row, styles.disabled] : styles.row)}
    >
      {children}
      <MaterialCommunityIcons
        testID="row-chevron"
        name="chevron-right"
        size={20}
        color={isDark ? darkColors.textMuted : colors.textSecondary}
      />
    </Pressable>
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
  disabled: {
    opacity: 0.5,
  },
});
