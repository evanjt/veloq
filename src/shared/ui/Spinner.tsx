/**
 * The indicator for a wait whose length is unknown.
 *
 * react-native's `ActivityIndicator` is the platform's own: the system
 * indicator on iOS and the Material indeterminate circle on Android. Paper's
 * draws a Material arc on both, which put a second spinner style on iOS, so a
 * wait is drawn here and `lint-source-rules.mjs --rule paper-spinner` refuses
 * Paper's.
 *
 * Coloured from the theme's primary token unless the surface it sits on asks
 * for another.
 */

import React from 'react';
import { ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';

export interface SpinnerProps {
  size?: 'small' | 'large';
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Spinner({ size = 'small', color, style, testID }: SpinnerProps) {
  const { isDark } = useTheme();
  const tint = color ?? (isDark ? darkColors.primary : colors.primary);
  return <ActivityIndicator size={size} color={tint} style={style} testID={testID} />;
}
