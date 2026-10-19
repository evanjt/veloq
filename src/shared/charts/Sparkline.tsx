import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Path, Skia } from '@shopify/react-native-skia';
import { Canvas } from '@/shared/ui/SkiaCanvas';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { DENSE_TEXT_SCALE, denseExtent } from '@/shared/ui/DenseText';
import { FitText } from '@/shared/ui/FitText';
import { chartStyles, spacing, typography } from '@/theme';

import { ChartSurface } from './ChartSurface';
import { ChartDot, ReticleMark, ScrubDot } from './ChartMarks';
import { LINE_CAP, LINE_JOIN, SPARKLINE_RETICLE, chartStroke, dotDisks } from './chartMarks';
import { seriesSummary, seriesTable, type SummarySeries } from './chartSummary';
import { sparklinePlacement, sparklineSvg } from './sparklinePlacement';
import { useChartColors } from './useChartColors';

/** One point of a sparkline: its value, where it sits for a reader, and its date if it has one. */
export interface SparklinePoint {
  value: number;
  /** Where the point sits, such as its day, read in the spoken summary and the table. */
  label: string;
  /** Tells two points with the same label apart. Defaults to the label. */
  key?: string;
  /** Any time unit, the same for every point. With dates on every point, points sit by date. */
  date?: number;
}

export interface SparklineProps {
  /** The quantity drawn, which the summary and the table name. */
  name: string;
  unit?: string | undefined;
  points: readonly SparklinePoint[];
  format: (value: number) => string;
  /** The plot's width, without the range beside it. */
  width: number;
  height: number;
  /** The line's colour, the single-series colour by default. */
  color?: string | undefined;
  /** The point ringed in ink: the attempt or day on screen. */
  highlightIndex?: number | undefined;
  /** The scrubbed point, which takes a dot. */
  scrubIndex?: number | undefined;
  /** Prints the high at the top of the plot and the low at the bottom, beside it. */
  showRange?: boolean | undefined;
  /** A lower value sits higher, for a quantity where less is better. */
  invert?: boolean | undefined;
  /** What a screen reader speaks, the series' span, latest value and range by default. */
  summary?: string | undefined;
  /** The x column of the Show data table. */
  xHeader?: string | undefined;
  /** False where the sparkline sits inside a pressable row; see `ChartSurface`. */
  showDataButton?: boolean | undefined;
  testID?: string | undefined;
}

/** The column the range is printed in, wide enough for a value and its unit at the cap. */
export const SPARKLINE_RANGE_WIDTH = denseExtent(typography.caption.fontSize, 5);

/**
 * A small trend inside a row, with its range shown and spoken. The line is the
 * chart's 2px series line, the last point carries a dot, a highlighted point is
 * marked by the reticle in ink, and points carrying dates sit at their date, so
 * an evenly spaced line never hides a gap in time.
 */
export const Sparkline = React.memo(function Sparkline({
  name,
  unit,
  points,
  format,
  width,
  height,
  color,
  highlightIndex,
  scrubIndex,
  showRange = false,
  invert = false,
  summary,
  xHeader,
  showDataButton = false,
  testID,
}: SparklineProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const lineColor = color ?? chartColors.series;
  const highlighted = highlightIndex !== undefined && points[highlightIndex] !== undefined;

  const placement = useMemo(() => {
    const values = points.map((p) => p.value);
    const dates = points.every((p) => p.date !== undefined)
      ? points.map((p) => p.date as number)
      : undefined;
    // Clear of the last point's dot, and of the reticle when one is drawn.
    const pad = highlighted ? SPARKLINE_RETICLE.inner + SPARKLINE_RETICLE.tick : dotDisks().ring;
    return sparklinePlacement(values, dates, { width, height, pad, invert });
  }, [points, width, height, invert, highlighted]);

  const path = useMemo(() => {
    const svg = sparklineSvg(placement.points);
    return svg ? Skia.Path.MakeFromSVGString(svg) : null;
  }, [placement]);

  const reading = useMemo(() => {
    const series: SummarySeries = {
      name,
      unit,
      points,
      format,
    };
    return {
      summary: summary ?? seriesSummary(series, t),
      table: seriesTable(name, xHeader ?? t('charts.column.date'), [series]),
    };
  }, [name, unit, points, format, summary, xHeader, t]);

  const last = placement.points[placement.points.length - 1];
  const mark = highlighted ? placement.points[highlightIndex] : undefined;
  const scrubbed = scrubIndex !== undefined ? placement.points[scrubIndex] : undefined;
  const labelStyle = [chartStyles.chartLabel, isDark && chartStyles.chartLabelDark];

  return (
    <View style={[styles.row, chartStyles.plotDirection]}>
      <View>
        <ChartSurface
          summary={reading.summary}
          table={reading.table}
          style={{ width, height, flex: undefined }}
          showDataButton={showDataButton}
          {...(testID ? { testID } : {})}
        >
          {width > 0 && height > 0 ? (
            <Canvas style={{ width, height }}>
              {path ? (
                <Path
                  path={path}
                  color={lineColor}
                  style="stroke"
                  strokeWidth={chartStroke.series}
                  strokeJoin={LINE_JOIN}
                  strokeCap={LINE_CAP}
                />
              ) : null}
              {last ? <ChartDot x={last.x} y={last.y} color={lineColor} /> : null}
              <ScrubDot at={scrubbed} color={lineColor} />
              {mark ? (
                <ReticleMark
                  x={mark.x}
                  y={mark.y}
                  inner={SPARKLINE_RETICLE.inner}
                  tick={SPARKLINE_RETICLE.tick}
                />
              ) : null}
            </Canvas>
          ) : null}
        </ChartSurface>
      </View>
      {showRange && points.length > 0 ? (
        <View
          testID={testID ? `${testID}-range` : undefined}
          style={[styles.range, { minHeight: height }]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <FitText style={labelStyle} maxFontSizeMultiplier={DENSE_TEXT_SCALE}>
            {format(invert ? placement.min : placement.max)}
          </FitText>
          <FitText style={labelStyle} maxFontSizeMultiplier={DENSE_TEXT_SCALE}>
            {format(invert ? placement.max : placement.min)}
          </FitText>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  range: {
    width: SPARKLINE_RANGE_WIDTH,
    justifyContent: 'space-between',
  },
});
