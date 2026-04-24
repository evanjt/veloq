import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography } from '@/theme';
import { formatDuration } from '@/lib';

interface ChartXAxisLabelProps {
  xAxisMode: 'distance' | 'time';
  maxX: number;
  isDark: boolean;
}

/**
 * Bottom-edge x-axis labels: `0` on the left, scrub hint in the middle, max
 * value on the right. Pure presentational wrapper used by {@link CombinedPlot}.
 */
export const ChartXAxisLabel = React.memo(function ChartXAxisLabel({
  xAxisMode,
  maxX,
  isDark,
}: ChartXAxisLabelProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.xAxis} pointerEvents="none">
      <Text style={[styles.xLabel, isDark && styles.xLabelDark]}>
        {xAxisMode === 'time' ? '0:00' : '0'}
      </Text>
      <Text style={[styles.xAxisHint, isDark && styles.xAxisHintDark]}>
        {t('activity.chartHint', 'Hold to scrub • Hold chip for axis')}
      </Text>
      <Text style={[styles.xLabel, isDark && styles.xLabelDark]}>
        {xAxisMode === 'time' ? formatDuration(maxX) : maxX.toFixed(1)}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  xAxis: {
    position: 'absolute',
    bottom: 2,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  xLabel: {
    fontSize: typography.micro.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  xLabelDark: {
    color: darkColors.textMuted,
  },
  xAxisHint: {
    fontSize: typography.micro.fontSize,
    fontWeight: '400',
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  xAxisHintDark: {
    color: darkColors.textMuted,
  },
});
