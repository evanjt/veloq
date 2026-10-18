/**
 * The scrub line: the one vertical line that follows a finger across a chart,
 * drawn in the crosshair colour at the crosshair width on every chart.
 *
 * Works with useChartGestures hook for unified chart interaction.
 */

import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import Animated, { AnimatedStyle } from 'react-native-reanimated';
import { spacing } from '@/theme';
import { chartStroke } from './chartMarks';
import { useChartColors } from './useChartColors';

export interface ChartCrosshairProps {
  /** Animated style from useChartGestures */
  style: AnimatedStyle<ViewStyle>;
  /** Top offset from chart container */
  topOffset?: number;
  /** Bottom offset from chart container */
  bottomOffset?: number;
}

export const ChartCrosshair = React.memo(function ChartCrosshair({
  style,
  topOffset = spacing.xs,
  bottomOffset = 20,
}: ChartCrosshairProps) {
  const { crosshair } = useChartColors();

  return (
    <Animated.View
      style={[
        styles.crosshair,
        {
          width: chartStroke.crosshair,
          backgroundColor: crosshair,
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
