import React, { useState } from 'react';
import { type LayoutChangeEvent } from 'react-native';
import { DenseText } from '@/shared/ui/DenseText';
import { chartStyles, stroke } from '@/theme';
import type { SeriesInfo } from '@/features/stats';

interface ChartYAxisLabelProps {
  yAxisSeries: SeriesInfo;
  yAxisAvgInfo: { normalised: number; raw: number } | null;
  showYAxisAccent: boolean;
  chartPaddingTop: number;
  chartPaddingBottom: number;
  height: number;
  isDark: boolean;
  /** The series' unit, printed once, on the top label. */
  unit: string;
  /**
   * Format a raw Y-axis value for display. Normally the series' own
   * formatter; passed in so the parent controls metric/imperial conversion
   * and rounding consistency.
   */
  formatYAxisValue: (value: number, series: SeriesInfo) => string;
}

const DEFAULT_LABEL_HEIGHT = 14;

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
  unit,
  formatYAxisValue,
}: ChartYAxisLabelProps) {
  // Offsets follow the rendered height so a larger system text size keeps the
  // labels on their lines. The default is the height at the standard size.
  const [labelHeight, setLabelHeight] = useState(DEFAULT_LABEL_HEIGHT);
  const onLayout = (e: LayoutChangeEvent) => setLabelHeight(e.nativeEvent.layout.height);
  const labelStyle = [chartStyles.chartLabelOnData, isDark && chartStyles.chartLabelOnDataDark];
  const max = formatYAxisValue(yAxisSeries.range.max, yAxisSeries);
  const accent = showYAxisAccent
    ? { borderLeftWidth: stroke.two, borderLeftColor: yAxisSeries.config.color }
    : null;

  return (
    <>
      {/* Max label - on the max reference line at chart top */}
      <DenseText
        style={[labelStyle, accent, { position: 'absolute', left: 4, top: chartPaddingTop }]}
        pointerEvents="none"
        onLayout={onLayout}
        testID="activity-plot-y-max"
      >
        {unit ? `${max} ${unit}` : max}
      </DenseText>
      {/* Min label - on the min reference line at chart bottom */}
      <DenseText
        style={[
          labelStyle,
          accent,
          { position: 'absolute', left: 4, top: height - chartPaddingBottom - labelHeight },
        ]}
        pointerEvents="none"
        onLayout={onLayout}
      >
        {formatYAxisValue(yAxisSeries.range.min, yAxisSeries)}
      </DenseText>
      {/* Avg label - on the dashed average line */}
      {yAxisAvgInfo ? (
        <DenseText
          style={[
            labelStyle,
            accent,
            {
              position: 'absolute',
              left: 4,
              top:
                chartPaddingTop +
                (1 - yAxisAvgInfo.normalised) * (height - chartPaddingTop - chartPaddingBottom) -
                labelHeight / 2,
            },
          ]}
          pointerEvents="none"
          onLayout={onLayout}
        >
          {formatYAxisValue(yAxisAvgInfo.raw, yAxisSeries)}
        </DenseText>
      ) : null}
    </>
  );
});
