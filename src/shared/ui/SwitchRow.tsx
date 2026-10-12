/**
 * A settings row that turns one thing on or off. The row is a single element
 * with the switch role, named by its title and described by its description, so
 * a screen reader reads one stop and a tap anywhere on the label toggles it. The
 * switch drawn at its end is hidden from assistive technology, since the row
 * already is that control, and still toggles from its own thumb.
 *
 * An `accessory`, such as an info button, sits between the label and the switch
 * as an element of its own, outside the pressable row, so it stays reachable.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { selection } from './haptics';
import { pressable, pressRipple } from './pressFeedback';
import { Switch } from './Switch';

/**
 * How far the row sits in from its container. `row` carries the row's own
 * padding, `none` sits in a card that pads its content already, and `nested`
 * indents a switch under the one that governs it.
 */
export type SwitchRowInset = 'row' | 'none' | 'nested';

export interface SwitchRowProps {
  title: string;
  /** A line under the title, read as the row's hint. */
  description?: string | undefined;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean | undefined;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap | undefined;
  accessory?: React.ReactNode;
  inset?: SwitchRowInset | undefined;
  /** On the row, which is the element a screen reader and a UI test reach. */
  testID?: string | undefined;
  titleTestID?: string | undefined;
  descriptionTestID?: string | undefined;
}

export function SwitchRow({
  title,
  description,
  value,
  onValueChange,
  disabled,
  icon,
  accessory,
  inset = 'row',
  testID,
  titleTestID,
  descriptionTestID,
}: SwitchRowProps) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  // An inactive control's label is exempt from the text bar, so the disabled
  // state reads as such rather than as a switch that happens to be off.
  const labelColor = disabled ? palette.textDisabled : palette.textPrimary;
  const iconColor = disabled ? palette.textDisabled : palette.textSecondary;

  const toggle = () => {
    selection();
    onValueChange(!value);
  };

  return (
    <View style={[styles.row, INSETS[inset].row]}>
      <Pressable
        testID={testID}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityHint={description}
        accessibilityState={{ checked: value, disabled: !!disabled }}
        onPress={toggle}
        disabled={disabled}
        android_ripple={pressRipple}
        style={pressable([styles.target, INSETS[inset].target])}
      >
        {icon && <MaterialCommunityIcons name={icon} size={22} color={iconColor} />}
        <View style={styles.label}>
          <Text testID={titleTestID} style={[styles.title, { color: labelColor }]}>
            {title}
          </Text>
          {description ? (
            <Text
              testID={descriptionTestID}
              style={[styles.description, { color: palette.textSecondary }]}
            >
              {description}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {accessory}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          accessibilityLabel={title}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  target: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: layout.minTapTarget,
  },
  label: {
    flex: 1,
  },
  title: {
    ...typography.body,
  },
  description: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  rowInset: { paddingRight: spacing.md },
  targetInset: { paddingLeft: spacing.md },
  targetNested: { paddingLeft: spacing.xl },
});

const INSETS = {
  row: { row: styles.rowInset, target: styles.targetInset },
  none: { row: undefined, target: undefined },
  nested: { row: styles.rowInset, target: styles.targetNested },
} as const;
