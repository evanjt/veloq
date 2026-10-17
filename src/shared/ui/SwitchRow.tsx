/**
 * A settings row that turns one thing on or off. The row is a single element
 * with the switch role, named by its title and described by its description, so
 * a screen reader reads one stop and a tap anywhere on the label toggles it. The
 * switch drawn at its end is hidden from assistive technology and held out of
 * keyboard focus, since the row already is that control, and still toggles from
 * its own thumb.
 *
 * An `accessory`, such as an info button, sits between the label and the switch
 * as an element of its own, outside the pressable row, so it stays reachable.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, layout, opacity, spacing, typography } from '@/theme';
import { Icon } from './Icon';
import { selection } from './haptics';
import { KeyboardFocusBlock } from './KeyboardFocusBlock';
import { PressTarget } from './PressTarget';
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

  const toggle = () => {
    selection();
    onValueChange(!value);
  };

  return (
    <View style={[styles.row, INSETS[inset].row, disabled && styles.disabled]}>
      <PressTarget
        testID={testID}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityHint={description}
        accessibilityState={{ checked: value, disabled: !!disabled }}
        onPress={toggle}
        disabled={disabled}
        style={[styles.target, INSETS[inset].target]}
      >
        {icon ? <Icon name={icon} size={iconSize.md} color={palette.textSecondary} /> : null}
        <View style={styles.label}>
          <Text testID={titleTestID} style={[styles.title, { color: palette.textPrimary }]}>
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
      </PressTarget>
      {accessory}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <KeyboardFocusBlock>
          <Switch
            value={value}
            onValueChange={onValueChange}
            disabled={disabled}
            accessibilityLabel={title}
          />
        </KeyboardFocusBlock>
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
  // The whole row fades, switch and label together, so the disabled state reads
  // as such rather than as a switch that happens to be off.
  disabled: {
    opacity: opacity.disabled,
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
