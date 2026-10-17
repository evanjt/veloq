import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/shared/app';
import { ChartErrorBoundary } from '@/shared/ui';
import { colorWithOpacity, ink, layout, opacity, spacing } from '@/theme';
import type { HistoryMark, InsightHistory, SeriesPoint } from '../types';
import { InsightSeriesChart } from './InsightSeriesChart';
import { formatDecimal } from '@/shared/format/number';

const CHART_HEIGHT = 180;

/** A series value as precise as its range needs, with the series' unit when it has one. */
export function formatSeriesValue(
  value: number,
  decimals: number,
  unit: string | undefined
): string {
  const number = formatDecimal(value, decimals);
  return unit ? `${number} ${unit}` : number;
}

/**
 * The sample the card's mark points at: the marked date, or the newest sample
 * inside a marked span, which is the value the card's claim ends on.
 */
function markedIndex(points: SeriesPoint[], mark: HistoryMark | undefined): number {
  if (!mark) return -1;
  if ('date' in mark) return points.findIndex((point) => point.date === mark.date);
  let index = -1;
  points.forEach((point, i) => {
    if (point.date >= mark.from && point.date <= mark.to) index = i;
  });
  return index;
}

interface InsightHistoryChartProps {
  /** The card's own history, which the sheet draws whole. */
  history: InsightHistory | undefined;
  color: string;
  /** Shown at the title's trailing edge, such as a glyph for the series' verdict. */
  accessory?: React.ReactNode;
}

/**
 * The history the card drew, at full size in its sheet: every sample, on the
 * shared scrubbable chart, bars where the card drew bars and a timeline's
 * fastest effort at the top. The card's mark is the chart's marker. A history
 * with no dated series, a section's line or the section trend's changes, is
 * drawn by the sheet's own rows instead.
 */
export const InsightHistoryChart = React.memo(function InsightHistoryChart({
  history,
  color,
  accessory,
}: InsightHistoryChartProps) {
  const { isDark } = useTheme();
  const series = history && 'series' in history ? history.series[0] : undefined;
  const kind = history && 'series' in history ? history.kind : undefined;
  const mark = history && 'series' in history ? history.mark : undefined;
  const points = series?.points;
  const format = series?.format;
  const unit = series?.unit;

  const formatValue = useCallback(
    (value: number, decimals: number) =>
      format ? format(value) : formatSeriesValue(value, decimals, unit),
    [format, unit]
  );
  const marker = useMemo(() => {
    const index = points ? markedIndex(points, mark) : -1;
    return index >= 0 ? { index, color } : null;
  }, [points, mark, color]);

  if (!series || !points || points.length < 2) return null;

  const timeline = kind === 'timeline';
  const dotColor = isDark
    ? colorWithOpacity(ink.white, opacity.dim)
    : colorWithOpacity(ink.black, 0.2);

  return (
    <ChartErrorBoundary height={CHART_HEIGHT}>
      <View testID="insight-history-chart" style={[styles.card, isDark && styles.cardDark]}>
        <InsightSeriesChart
          samples={points}
          title={series.label}
          color={color}
          formatValue={formatValue}
          invert={timeline}
          bars={kind === 'bars'}
          marker={marker}
          accessory={accessory}
          {...(timeline ? { pointColor: dotColor } : {})}
        />
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
  },
  cardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
});
