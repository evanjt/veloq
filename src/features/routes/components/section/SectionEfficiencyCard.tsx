/**
 * Aerobic efficiency on a section or a route: heart rate per unit of speed across every
 * counted effort in the page's range that carried both signals, oldest to newest. The
 * engine computes the series and the regression in the performance read, this only
 * plots them.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { useTranslation } from 'react-i18next';
import { Card, ChangeChip } from '@/shared/ui';
import {
  ChartSurface,
  lanesSummary,
  polylineSvgPath,
  seriesTable,
  useMeasuredWidth,
  type SummarySeries,
  type XY,
} from '@/shared/charts';
import { formatSigned } from '@/shared/format';
import { formatShortDate } from '@/shared/format/format';
import type { TrendDirection, TrendVerdict } from '@/shared/format/trend';
import { colors, darkColors, spacing, stroke, typography } from '@/theme';
import { EfficiencyDirection, type EfficiencyPoint, type EfficiencyTrend } from 'veloqrs';

const CHART_HEIGHT = 56;
const PAD = 6;
const LATEST_DOT_RADIUS = 3;

/**
 * Scale a ratio series onto the canvas. A lower ratio is less cardiac cost
 * for the same pace, so it sits higher. Efforts are placed by date, so a long
 * gap between two of them reads as one. A flat series has no range to scale
 * against and is drawn down the middle, and a series whose efforts share one
 * date has no time to spread over and is spaced evenly.
 */
export function efficiencySeriesVertices(
  points: EfficiencyPoint[],
  width: number,
  height: number
): XY[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [];

  const ratios = points.map((p) => p.hrPaceRatio);
  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  const range = max - min;
  const span = last.date - first.date;
  const byDate = Number.isFinite(span) && span > 0;
  const w = width - PAD * 2;
  const h = height - PAD * 2;

  const along = (date: number, i: number) => {
    if (points.length === 1) return 0.5;
    return byDate ? (date - first.date) / span : i / (points.length - 1);
  };

  return points.map(({ date, hrPaceRatio }, i) => ({
    x: PAD + along(date, i) * w,
    y: range === 0 ? PAD + h / 2 : PAD + ((hrPaceRatio - min) / range) * h,
  }));
}

/** The engine's direction as the badge states it: its word, its judgement, and the ratio's move. */
const VERDICTS = {
  [EfficiencyDirection.Improving]: {
    word: 'sections.efficiencyVerdictImproving',
    verdict: 'improved',
    direction: 'down',
  },
  [EfficiencyDirection.Flat]: {
    word: 'sections.efficiencyVerdictFlat',
    verdict: 'flat',
    direction: 'flat',
  },
  [EfficiencyDirection.Worsening]: {
    word: 'sections.efficiencyVerdictWorsening',
    verdict: 'declined',
    direction: 'up',
  },
} as const satisfies Record<
  EfficiencyDirection,
  { word: string; verdict: TrendVerdict; direction: TrendDirection }
>;

export interface SectionEfficiencyCardProps {
  /** The performance read's trend for the sport on screen, absent while it is read. */
  trend: EfficiencyTrend | null | undefined;
  isDark: boolean;
}

export function SectionEfficiencyCard({ trend, isDark }: SectionEfficiencyCardProps) {
  const { t } = useTranslation();
  const { width, onLayout } = useMeasuredWidth();

  const reading = useMemo(() => {
    if (!trend || trend.points.length === 0) return null;
    const unit = t('units.bpmSecondsPerKm');
    const format = (ratio: number) => `${Math.round(ratio)} ${unit}`;
    const ratios = trend.points.map((p) => p.hrPaceRatio);
    const series: SummarySeries = {
      name: t('insights.efficiencyTrend.quantity'),
      unit,
      points: trend.points.map((p) => ({
        label: formatShortDate(new Date(p.date * 1000)),
        key: String(p.date),
        value: p.hrPaceRatio,
      })),
      format,
    };
    const title = t('sections.aerobicEfficiency');
    return {
      range: t('sections.aerobicEfficiencyRange', {
        min: format(Math.min(...ratios)),
        max: format(Math.max(...ratios)),
      }),
      summary: lanesSummary(
        t('sections.aerobicEfficiencySpoken', { title, efforts: trend.effortCount }),
        [series],
        t
      ),
      table: seriesTable(title, t('charts.column.date'), [series]),
    };
  }, [trend, t]);

  if (!trend) return null;

  const vertices = width > 0 ? efficiencySeriesVertices(trend.points, width, CHART_HEIGHT) : [];
  const linePath =
    vertices.length > 1 ? Skia.Path.MakeFromSVGString(polylineSvgPath(vertices)) : null;
  const latest = vertices[vertices.length - 1];
  const signedHrChange = formatSigned(trend.hrChangeBpm, 0);
  const seriesColor = isDark ? darkColors.chartSeries : colors.chartSeries;
  const verdict = VERDICTS[trend.direction];

  return (
    <Card
      variant="flat"
      testID="section-efficiency-card"
      accessibilityRole="summary"
      title={t('sections.aerobicEfficiency')}
      style={{ gap: spacing.xs }}
    >
      <View style={styles.detailLine}>
        <Text
          testID="section-efficiency-detail"
          style={[styles.detail, isDark && styles.detailDark]}
        >
          {t('sections.aerobicEfficiencyDetail', {
            efforts: trend.effortCount,
            hrChange: signedHrChange,
          })}
        </Text>
        {verdict ? (
          <ChangeChip
            testID="section-efficiency-verdict"
            text={t(verdict.word)}
            trend={{ direction: verdict.direction, verdict: verdict.verdict }}
            isDark={isDark}
          />
        ) : null}
      </View>

      <View onLayout={onLayout}>
        <ChartSurface
          testID="section-efficiency-chart"
          summary={reading?.summary ?? ''}
          table={reading?.table ?? null}
          style={styles.plot}
        >
          {width > 0 ? (
            <Canvas style={{ width, height: CHART_HEIGHT }}>
              {linePath ? (
                <Path path={linePath} color={seriesColor} style="stroke" strokeWidth={stroke.two} />
              ) : null}
              {latest ? (
                <Circle cx={latest.x} cy={latest.y} r={LATEST_DOT_RADIUS} color={seriesColor} />
              ) : null}
            </Canvas>
          ) : null}
        </ChartSurface>
      </View>

      {reading ? (
        <Text
          testID="section-efficiency-range"
          style={[styles.caption, isDark && styles.captionDark]}
        >
          {reading.range}
        </Text>
      ) : null}
      <Text testID="section-efficiency-axis" style={[styles.caption, isDark && styles.captionDark]}>
        {t('sections.aerobicEfficiencyInverted')}
      </Text>
      <Text
        testID="section-efficiency-caption"
        style={[styles.caption, isDark && styles.captionDark]}
      >
        {t('sections.aerobicEfficiencyCaption', {
          quantity: t('insights.efficiencyTrend.quantity'),
        })}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  detailLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detail: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  detailDark: {
    color: darkColors.textSecondary,
  },
  plot: {
    height: CHART_HEIGHT,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  captionDark: {
    color: darkColors.textSecondary,
  },
});
