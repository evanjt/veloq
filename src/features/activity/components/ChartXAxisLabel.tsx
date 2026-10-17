import React, { useImperativeHandle, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { chartStyles, colors, darkColors, typography } from '@/theme';
import { DenseText } from '@/shared/ui/DenseText';
import { formatDuration } from '@/shared/format/format';
import { formatDecimal } from '@/shared/format';

interface ChartXAxisLabelProps {
  xAxisMode: 'distance' | 'time';
  maxX: number;
  /** Distance unit label (`km` or `mi`). Empty string for time mode. */
  xUnit: string;
  isDark: boolean;
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
 * the right, and between them the scrub position while a scrub is in flight
 * or the scrub hint when none is.
 *
 * The scrub value is state of this component's own, pushed in through the
 * handle rather than passed as a prop. Held at the chart root it re-rendered
 * the whole chart on every index the gesture crossed, and this label is the
 * only thing that draws it.
 */
export const ChartXAxisLabel = React.memo(
  React.forwardRef<ChartXAxisLabelHandle, ChartXAxisLabelProps>(function ChartXAxisLabel(
    { xAxisMode, maxX, xUnit, isDark },
    ref
  ) {
    const { t } = useTranslation();
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
      <View style={styles.xAxis} pointerEvents="none">
        <DenseText style={[chartStyles.axisLabel, isDark && chartStyles.axisLabelDark]}>
          {isTime ? '0:00' : '0'}
        </DenseText>
        {scrubLabel !== null ? (
          <DenseText
            testID="chart-x-axis-scrub"
            style={[chartStyles.axisLabel, styles.xScrub, isDark && styles.xScrubDark]}
          >
            {scrubLabel}
          </DenseText>
        ) : (
          <DenseText style={[styles.xAxisHint, isDark && styles.xAxisHintDark]}>
            {t('activity.chartHint', 'Hold to scrub • Hold chip for axis')}
          </DenseText>
        )}
        <DenseText style={[chartStyles.axisLabel, isDark && chartStyles.axisLabelDark]}>
          {maxLabel}
        </DenseText>
      </View>
    );
  })
);

const styles = StyleSheet.create({
  xAxis: {
    position: 'absolute',
    bottom: 2,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  xScrub: {
    color: colors.textPrimary,
  },
  xScrubDark: {
    color: darkColors.textPrimary,
  },
  xAxisHint: {
    ...typography.micro,
    color: colors.textSecondary,
  },
  xAxisHintDark: {
    color: darkColors.textSecondary,
  },
});
