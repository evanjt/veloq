/**
 * Aerobic efficiency on a section or a route: heart rate per unit of speed across every
 * counted effort in the page's range that carried both signals, oldest to newest. The
 * engine computes the series and the regression in the performance read, this only
 * plots them.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Card, ChangeChip } from '@/shared/ui';
import {
  lanesSummary,
  Sparkline,
  SPARKLINE_RANGE_WIDTH,
  useMeasuredWidth,
  type SparklinePoint,
  type SummarySeries,
} from '@/shared/charts';
import { formatSigned } from '@/shared/format';
import { formatShortDate } from '@/shared/format/format';
import type { TrendDirection, TrendVerdict } from '@/shared/format/trend';
import { colors, darkColors, spacing, typography } from '@/theme';
import { EfficiencyDirection, type EfficiencyTrend } from 'veloqrs';

const CHART_HEIGHT = 56;

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
    const name = t('insights.efficiencyTrend.quantity');
    // Efforts sit at their date, so a long gap between two of them reads as one.
    const points: SparklinePoint[] = trend.points.map((p) => ({
      label: formatShortDate(new Date(p.date * 1000)),
      key: String(p.date),
      value: p.hrPaceRatio,
      date: p.date,
    }));
    const series: SummarySeries = { name, unit, points, format };
    return {
      name,
      unit,
      points,
      format,
      summary: lanesSummary(
        t('sections.aerobicEfficiencySpoken', {
          title: t('sections.aerobicEfficiency'),
          efforts: trend.effortCount,
        }),
        [series],
        t
      ),
    };
  }, [trend, t]);

  if (!trend) return null;

  const signedHrChange = formatSigned(trend.hrChangeBpm, 0);
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
        {reading ? (
          // A lower ratio is less cardiac cost for the same pace, so it sits higher.
          <Sparkline
            testID="section-efficiency-chart"
            name={reading.name}
            unit={reading.unit}
            points={reading.points}
            format={reading.format}
            summary={reading.summary}
            width={Math.max(0, width - SPARKLINE_RANGE_WIDTH - spacing.xs)}
            height={CHART_HEIGHT}
            color={isDark ? darkColors.chartSeries : colors.chartSeries}
            showRange
            invert
            showDataButton
          />
        ) : (
          <View style={styles.plot} />
        )}
      </View>

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
