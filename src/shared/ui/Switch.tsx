/**
 * The one switch in the app. Every other file draws a switch through this one or
 * through `SwitchRow`, and `scripts/lint-switch-owner.mjs` refuses any other
 * import of a switch, so the colours and the name cannot drift per screen.
 *
 * It is Paper's `Switch`, which is the platform's own control with theme colours.
 * The colours come from the theme and never from the caller: on iOS only the on
 * track is tinted and the thumb is the system's, on Android the thumb and track
 * follow the state from per-mode tokens, the off track at 3:1 on every surface.
 */

import React, { useCallback } from 'react';
import { Platform } from 'react-native';
import { Switch as PaperSwitch } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { colors, colorWithOpacity, darkColors, switchTrackOff } from '@/theme';
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
  trackColor: { true: string; false?: string };
  thumbColor?: string;
}

/** The colours a switch draws in, by mode, state and platform. */
export function switchColors(
  isDark: boolean,
  value: boolean,
  os: typeof Platform.OS = Platform.OS
): SwitchColors {
  const primary = isDark ? darkColors.primary : colors.primary;
  if (os === 'ios') return { trackColor: { true: primary } };
  const trackOff = isDark ? switchTrackOff.dark : switchTrackOff.light;
  const thumbOff = isDark ? darkColors.textSecondary : colors.surface;
  return {
    thumbColor: value ? primary : thumbOff,
    trackColor: { true: colorWithOpacity(primary, 0.5), false: trackOff },
  };
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
