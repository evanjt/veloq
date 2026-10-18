import React, { useImperativeHandle, useState } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { chartStyles, colors, darkColors, spacing } from '@/theme';
import { DenseText } from '@/shared/ui/DenseText';
import { formatDuration } from '@/shared/format/format';
import { formatDecimal } from '@/shared/format';

interface ChartXAxisLabelProps {
  xAxisMode: 'distance' | 'time';
  maxX: number;
  /** Distance unit label (`km` or `mi`). Empty string for time mode. */
  xUnit: string;
  isDark: boolean;
  /** Where the row sits: its height and the gutter it leaves before the plot. */
  style?: StyleProp<ViewStyle>;
}

/** How the chart pushes a scrub position into the axis label. */
export interface ChartXAxisLabelHandle {
  /**
   * The live scrub position, or null when the gesture ends. Zero is a
   * position, so the absent one has to be null rather than falsy.
   */
  setScrub: (x: number | null) => void;
}

function withUnit(value: string, unit: string): string {
  return unit ? `${value} ${unit}` : value;
}

/**
 * Bottom-gutter x-axis labels: `0` on the left, the maximum with its unit on
 * the right, and between them the scrub position while a scrub is in flight.
 *
 * The scrub value is state of this component's own, pushed in through the
 * handle rather than passed as a prop. Held at the chart root it re-rendered
 * the whole chart on every index the gesture crossed, and this label is the
 * only thing that draws it.
 */
export const ChartXAxisLabel = React.memo(
  React.forwardRef<ChartXAxisLabelHandle, ChartXAxisLabelProps>(function ChartXAxisLabel(
    { xAxisMode, maxX, xUnit, isDark, style },
    ref
  ) {
    const [scrub, setScrub] = useState<number | null>(null);
    useImperativeHandle(ref, () => ({ setScrub }), []);

    const isTime = xAxisMode === 'time';
    const maxLabel = isTime ? formatDuration(maxX) : withUnit(formatDecimal(maxX, 1), xUnit);
    const scrubLabel =
      scrub === null
        ? null
        : isTime
          ? formatDuration(scrub)
          : withUnit(formatDecimal(scrub, 2), xUnit);

    return (
      <View style={[styles.xAxis, style]} pointerEvents="none">
        <DenseText style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}>
          {isTime ? '0:00' : '0'}
        </DenseText>
        {scrubLabel !== null ? (
          <DenseText
            testID="chart-x-axis-scrub"
            style={[chartStyles.chartLabel, styles.xScrub, isDark && styles.xScrubDark]}
          >
            {scrubLabel}
          </DenseText>
        ) : null}
        <DenseText style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}>
          {maxLabel}
        </DenseText>
      </View>
    );
  })
);

const styles = StyleSheet.create({
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.xs,
  },
  xScrub: {
    color: colors.textPrimary,
  },
  xScrubDark: {
    color: darkColors.textPrimary,
  },
});
