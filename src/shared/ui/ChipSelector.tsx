import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { spacing } from '@/theme';
import { ToggleButton } from './Button';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** Fills the selected chip, for an option that stands for a series. */
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
 * the app's selector chips, the chosen one filled.
 */
export function ChipSelector<T extends string>({
  options,
  value,
  onChange,
  optionTestID,
  style,
}: ChipSelectorProps<T>) {
  return (
    <View style={[styles.row, style]}>
      {options.map((option) => (
        <ToggleButton
          key={option.value}
          {...(optionTestID && { testID: optionTestID(option.value) })}
          label={option.label}
          selected={option.value === value}
          {...(option.accent && { fill: option.accent })}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
