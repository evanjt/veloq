/**
 * Consistent crosshair component for chart interactions.
 *
 * Provides a vertical line indicator that follows touch position.
 * Works with useChartGestures hook for unified chart interaction.
 */

import React from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import Animated, { AnimatedStyle } from 'react-native-reanimated';
import { ViewStyle } from 'react-native';
import { colors, darkColors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export interface ChartCrosshairProps {
  /** Animated style from useChartGestures */
  style: AnimatedStyle<ViewStyle>;
  /** Override default color */
  color?: string;
  /** Override default width */
  width?: number;
  /** Top offset from chart container */
  topOffset?: number;
  /** Bottom offset from chart container */
  bottomOffset?: number;
}

export const ChartCrosshair = React.memo(function ChartCrosshair({
  style,
  color,
  width = 1.5,
  topOffset = spacing.xs,
  bottomOffset = 20,
}: ChartCrosshairProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const defaultColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <Animated.View
      style={[
        styles.crosshair,
        {
          width,
          backgroundColor: color || defaultColor,
          top: topOffset,
          bottom: bottomOffset,
        },
        style,
      ]}
      pointerEvents="none"
    />
  );
});

const styles = StyleSheet.create({
  crosshair: {
    position: 'absolute',
  },
});

export default ChartCrosshair;
