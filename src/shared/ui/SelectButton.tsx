/**
 * The one control for a choice of one from more than three options: a small
 * secondary button that reads the current value with a trailing chevron, and
 * opens the list on the context menu's anchored popup.
 *
 * Three options or fewer are a `ToggleButtonRow`, where every option shows at
 * once. The popup holds a short list, up to about six; a longer one belongs in
 * a sheet.
 *
 * The popup is the same list on both platforms. A tap cannot open the iOS
 * system menu from this stack, so the anchored popup serves both.
 */

import React, { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { Button } from './Button';
import { Icon } from './Icon';
import { MenuPopup } from './ContextMenu';
import * as haptics from './haptics';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A glyph drawn beside the label in the list. */
  icon?: React.ComponentProps<typeof Icon>['name'] | undefined;
}

export interface SelectButtonProps<T extends string> {
  /** The current choice, or null when it is none of the options. */
  value: T | null;
  options: readonly SelectOption<T>[];
  /** Called once with a choice that differs from `value`. */
  onChange: (value: T) => void;
  /** Names the choice, read before the value and as the list's title. */
  accessibilityLabel: string;
  /** What the button reads when the value is none of the options, such as a group whose members disagree. */
  unmatchedLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** What a screen reader says for the control: its name, then the value it reads. */
export function selectLabel(accessibilityLabel: string, optionLabel: string): string {
  return `${accessibilityLabel}: ${optionLabel}`;
}

export function SelectButton<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  unmatchedLabel = '',
  disabled = false,
  style,
  testID,
}: SelectButtonProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  const label = current?.label ?? unmatchedLabel;

  return (
    <MenuPopup
      title={accessibilityLabel}
      visible={open}
      onDismiss={() => setOpen(false)}
      closeOnSelect
      entries={options.map((option) => ({
        key: option.value,
        label: option.label,
        icon: option.icon,
        checked: option.value === value,
        onPress: () => {
          if (option.value === value) return;
          haptics.selection();
          onChange(option.value);
        },
      }))}
    >
      <Button
        variant="secondary"
        size="sm"
        opensMenu
        expanded={open}
        label={label}
        accessibilityLabel={selectLabel(accessibilityLabel, label)}
        onPress={() => setOpen(true)}
        disabled={disabled}
        {...(style !== undefined && { style })}
        {...(testID !== undefined && { testID })}
      />
    </MenuPopup>
  );
}
