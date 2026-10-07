import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { pressable, pressRipple } from './pressFeedback';
import { useTheme } from '@/shared/app';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** Colours the selected chip and its text, for an option that stands for a series. */
  accent?: string;
}

export interface ChipSelectorProps<T extends string> {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The test id of each chip, from its value. */
  optionTestID?: (value: T) => string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The compact selector for a screen's choices between a few options: a row of
 * tinted chips, the chosen one filled. Selection is also on
 * `accessibilityState.selected`, so it is not colour alone.
 */
export function ChipSelector<T extends string>({
  options,
  value,
  onChange,
  optionTestID,
  style,
}: ChipSelectorProps<T>) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  return (
    <View style={[styles.row, style]}>
      {options.map((option) => {
        const selected = option.value === value;
        const tint = option.accent ?? palette.primary;
        return (
          <Pressable
            key={option.value}
            testID={optionTestID?.(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            android_ripple={pressRipple}
            style={pressable([styles.chip, selected && { backgroundColor: tint + '20' }])}
          >
            <Text
              numberOfLines={1}
              style={[styles.label, { color: selected ? tint : palette.textSecondary }]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusMd,
  },
  label: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
  },
});
