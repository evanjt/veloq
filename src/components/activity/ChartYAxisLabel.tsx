import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, darkColors, typography } from '@/theme';
import type { SeriesInfo } from '@/lib/charts/combinedPlotData';

interface ChartYAxisLabelProps {
  yAxisSeries: SeriesInfo;
  yAxisAvgInfo: { normalized: number; raw: number } | null;
  showYAxisAccent: boolean;
  chartPaddingTop: number;
  chartPaddingBottom: number;
  height: number;
  isDark: boolean;
  /**
   * Format a raw Y-axis value for display. Normally the series' own
   * formatter; passed in so the parent controls metric/imperial conversion
   * and rounding consistency.
   */
  formatYAxisValue: (value: number, series: SeriesInfo) => string;
}

/**
 * Y-axis min/max/avg labels overlaid on the chart. Rendered as absolutely
 * positioned Text rather than Victory axis ticks so they can sit exactly on
 * the Skia reference lines drawn by the parent.
 */
export const ChartYAxisLabel = React.memo(function ChartYAxisLabel({
  yAxisSeries,
  yAxisAvgInfo,
  showYAxisAccent,
  chartPaddingTop,
  chartPaddingBottom,
  height,
  isDark,
  formatYAxisValue,
}: ChartYAxisLabelProps) {
  const accent = showYAxisAccent
    ? { borderLeftWidth: 2, borderLeftColor: yAxisSeries.color }
    : null;

  return (
    <>
      {/* Max label — on the max reference line at chart top */}
      <Text
        style={[
          styles.yLabel,
          isDark && styles.yLabelDark,
          accent,
          { position: 'absolute', left: 4, top: chartPaddingTop },
        ]}
        pointerEvents="none"
      >
        {formatYAxisValue(yAxisSeries.range.max, yAxisSeries)}
      </Text>
      {/* Min label — on the min reference line at chart bottom */}
      <Text
        style={[
          styles.yLabel,
          isDark && styles.yLabelDark,
          accent,
          { position: 'absolute', left: 4, top: height - chartPaddingBottom - 14 },
        ]}
        pointerEvents="none"
      >
        {formatYAxisValue(yAxisSeries.range.min, yAxisSeries)}
      </Text>
      {/* Avg label — on the dashed average line */}
      {yAxisAvgInfo && (
        <Text
          style={[
            styles.yLabel,
            isDark && styles.yLabelDark,
            accent,
            {
              position: 'absolute',
              left: 4,
              top:
                chartPaddingTop +
                (1 - yAxisAvgInfo.normalized) * (height - chartPaddingTop - chartPaddingBottom) -
                7,
            },
          ]}
          pointerEvents="none"
        >
          {formatYAxisValue(yAxisAvgInfo.raw, yAxisSeries)}
        </Text>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  yLabel: {
    fontSize: typography.micro.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  yLabelDark: {
    color: darkColors.textSecondary,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
});
