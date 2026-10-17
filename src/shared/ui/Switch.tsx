/**
 * The one switch in the app. Every other file draws a switch through this one or
 * through `SwitchRow`, and `scripts/lint-switch-owner.mjs` refuses any other
 * import of a switch, so the colours and the name cannot drift per screen.
 *
 * It is Paper's `Switch`, which is the platform's own control with theme colours.
 * The colours come from the theme and never from the caller. The on track is
 * `controlOn` and the off track `controlBoundary`, each a mark at 3:1 on every
 * surface. On iOS the thumb is the system's; on Android it is white on the on
 * track and the surface on the off one, so it holds 3:1 against either.
 */

import React, { useCallback } from 'react';
import { Platform } from 'react-native';
import { Switch as PaperSwitch } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';
import { selection } from './haptics';

export interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** What the switch turns on, read with its state by a screen reader. */
  accessibilityLabel: string;
  disabled?: boolean | undefined;
  testID?: string | undefined;
}

export interface SwitchColors {
  trackColor: { true: string; false: string };
  thumbColor?: string;
  /** The iOS off track's fill, which `trackColor.false` alone only outlines. */
  ios_backgroundColor?: string;
}

/** The colours a switch draws in, by mode, state and platform. */
export function switchColors(
  isDark: boolean,
  value: boolean,
  os: typeof Platform.OS = Platform.OS
): SwitchColors {
  const palette = isDark ? darkColors : colors;
  const trackColor = { true: palette.controlOn, false: palette.controlBoundary };
  if (os === 'ios') return { trackColor, ios_backgroundColor: palette.controlBoundary };
  return { thumbColor: value ? colors.textOnFill : palette.surface, trackColor };
}

export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled,
  testID,
}: SwitchProps) {
  const { isDark } = useTheme();
  const handleChange = useCallback(
    (next: boolean) => {
      selection();
      onValueChange(next);
    },
    [onValueChange]
  );

  return (
    <PaperSwitch
      testID={testID}
      value={value}
      onValueChange={handleChange}
      disabled={!!disabled}
      accessibilityLabel={accessibilityLabel}
      {...switchColors(isDark, value)}
    />
  );
}
