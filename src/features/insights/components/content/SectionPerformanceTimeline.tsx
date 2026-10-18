import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { formatDuration, safeGetTime } from '@/shared/format/format';
import { spacing, opacity, ink, layout, colorWithOpacity, themePalette } from '@/theme';
import { ChartErrorBoundary } from '@/shared/ui';
import type { SectionPerformanceRecord } from '@/features/routes';
import {
  directionEfforts,
  plottedDirection,
  type DirectionBests,
} from '@/features/insights/lib/directionBests';
import { InsightSeriesChart } from '../InsightSeriesChart';

const CHART_HEIGHT = 200;

interface SectionPerformanceTimelineProps {
  records: SectionPerformanceRecord[];
  bests: DirectionBests;
  /** Chart line color */
  lineColor?: string;
}

const formatTime = (seconds: number) => formatDuration(Math.round(seconds));

/**
 * Every effort on the section over date, its time on the value axis with the
 * fastest at the top. An out-and-back plots the direction holding the record,
 * and the record carries a distinct marker.
 */
export const SectionPerformanceTimeline = React.memo(function SectionPerformanceTimeline({
  records,
  bests,
  lineColor: lineColorProp,
}: SectionPerformanceTimelineProps) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const lineColor = lineColorProp ?? palette.actionPrimary;
  const { t } = useTranslation();

  const sorted = useMemo(() => {
    const efforts = directionEfforts(records, bests);
    const direction = plottedDirection(efforts, bests);
    return efforts
      .filter((e) => e.direction === direction)
      .sort((a, b) => safeGetTime(a.record.activityDate) - safeGetTime(b.record.activityDate));
  }, [records, bests]);

  const samples = useMemo(
    () => sorted.map((e) => ({ value: e.time, date: safeGetTime(e.record.activityDate) / 1000 })),
    [sorted]
  );

  const bestIndex = sorted.findIndex((e) => e.isPr);
  const marker = useMemo(
    () => (bestIndex >= 0 ? { index: bestIndex, kind: 'record' as const } : null),
    [bestIndex]
  );

  if (sorted.length < 2) return null;

  const dotColor = isDark
    ? colorWithOpacity(ink.white, opacity.dim)
    : colorWithOpacity(ink.black, opacity.tint3);

  return (
    <ChartErrorBoundary height={CHART_HEIGHT}>
      <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
        <InsightSeriesChart
          samples={samples}
          title={t('insights.sectionPrSheet.allEfforts', { n: sorted.length })}
          color={lineColor}
          formatValue={formatTime}
          invert
          pointColor={dotColor}
          marker={marker}
        />
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
  chartCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
  },
  chartCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
});
