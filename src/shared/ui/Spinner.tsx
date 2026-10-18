/**
 * The indicator for a wait whose length is unknown.
 *
 * react-native's `ActivityIndicator` is the platform's own: the system
 * indicator on iOS and the Material indeterminate circle on Android. Paper's
 * draws a Material arc on both, which put a second spinner style on iOS, so a
 * wait is drawn here, `lint-source-rules.mjs --rule paper-spinner` refuses
 * Paper's and `--rule bare-spinner` refuses react-native's anywhere else.
 *
 * Drawn in the theme's link colour unless the ground it sits on asks for
 * another, such as a map or an image. A spinner standing alone names what is
 * loading to a screen reader. One inside a control names nothing, because the
 * control carries the name and its busy state.
 */

import React from 'react';
import {
  ActivityIndicator,
  type AccessibilityValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';

interface SpinnerBase {
  size?: 'small' | 'large';
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
  /**
   * Read as a progress bar: `true` while no count is known yet, the count once
   * it is. Without it the spinner is a busy element and nothing more.
   */
  progress?: AccessibilityValue | true | undefined;
}

export type SpinnerProps = SpinnerBase &
  (
    | { /** What is loading, read by a screen reader. */ label: string; inControl?: false }
    | { /** Inside a control that names the wait itself. */ inControl: true; label?: undefined }
  );

export function Spinner({ size = 'small', color, style, testID, label, progress }: SpinnerProps) {
  const { isDark } = useTheme();
  const tint = color ?? (isDark ? darkColors : colors).actionLink;
  const named = label !== undefined;
  return (
    <ActivityIndicator
      size={size}
      color={tint}
      style={style}
      testID={testID}
      accessible={named}
      accessibilityRole={named && progress ? 'progressbar' : undefined}
      accessibilityLabel={label}
      accessibilityState={named ? { busy: true } : undefined}
      accessibilityValue={named && progress !== true ? progress : undefined}
    />
  );
}
