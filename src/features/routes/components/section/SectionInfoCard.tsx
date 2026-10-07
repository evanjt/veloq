/**
 * Summary card showing first/last visited dates and best/average times.
 * Displayed between the scatter chart and the calendar history.
 */

import { useMetricSystem } from '@/shared/app';
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Card, Shimmer } from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import { getIntlLocale, formatDuration, formatPace, formatSwimPace } from '@/shared/format/format';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import type { PerformanceDataPoint, DirectionStats, ActivityType } from '@/types';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

const INFO_CARD_PLACEHOLDER_HEIGHT = 96;
const REVERSE_COLOR = colors.reverseDirection;

/** Format date as "Jan '24" */
function formatShortYearDate(date: Date): string {
  const month = date.toLocaleDateString(getIntlLocale(), { month: 'short' });
  const year = date.getFullYear().toString().slice(-2);
  return `${month} '${year}`;
}

export interface SectionInfoCardProps {
  chartData: (PerformanceDataPoint & { x: number })[];
  bestForwardRecord: SectionPerformanceRecord | null;
  bestReverseRecord: SectionPerformanceRecord | null;
  forwardStats: DirectionStats | null;
  reverseStats: DirectionStats | null;
  /** The sport on screen, absent until the engine has answered. */
  sportType: string | undefined;
  isDark: boolean;
  /** Colour of the forward direction's dot. */
  activityColor?: string;
  /** Streams are still downloading, so the card holds its place. */
  pending?: boolean;
}

export function SectionInfoCard({
  chartData,
  bestForwardRecord,
  bestReverseRecord,
  forwardStats,
  reverseStats,
  sportType,
  isDark,
  activityColor,
  pending = false,
}: SectionInfoCardProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  const showsPace = isPaceSport(sportType as ActivityType);
  const isSwimming = isSwimmingActivity(sportType as ActivityType);
  const showPace = showsPace || isSwimming;

  // Compute first and last visited dates from chart data
  const { firstDate, lastDate } = useMemo(() => {
    if (chartData.length === 0) return { firstDate: null, lastDate: null };

    let min = chartData[0].date;
    let max = chartData[0].date;
    for (const p of chartData) {
      if (p.isExcluded) continue;
      if (p.date < min) min = p.date;
      if (p.date > max) max = p.date;
    }
    return { firstDate: min, lastDate: max };
  }, [chartData]);

  const formatBest = (record: SectionPerformanceRecord | null): string | null => {
    if (!record) return null;
    if (!showPace) return formatDuration(record.bestTime);
    return isSwimming
      ? formatSwimPace(record.bestPace, isMetric)
      : formatPace(record.bestPace, isMetric);
  };

  const formatAvg = (stats: DirectionStats | null): string | null => {
    if (!stats || stats.avgTime == null) return null;
    if (showPace && stats.avgSpeed != null && stats.avgSpeed > 0) {
      return isSwimming
        ? formatSwimPace(stats.avgSpeed, isMetric)
        : formatPace(stats.avgSpeed, isMetric);
    }
    return formatDuration(stats.avgTime);
  };

  if (pending && (!firstDate || !lastDate)) {
    return (
      <Card variant="flat" testID="section-info-pending">
        <Shimmer height={INFO_CARD_PLACEHOLDER_HEIGHT} />
      </Card>
    );
  }

  if (!firstDate || !lastDate) return null;

  const labelColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const valueColor = isDark ? darkColors.textPrimary : colors.textPrimary;

  const forwardBest = formatBest(bestForwardRecord);
  const reverseBest = formatBest(bestReverseRecord);
  const forwardAvg = formatAvg(forwardStats);
  const reverseAvg = formatAvg(reverseStats);
  const bothDirections = (forwardBest || forwardAvg) && (reverseBest || reverseAvg);

  const columns: { label: string; value: string; testID?: string; dotColor?: string }[] = [
    {
      label: t('sections.firstVisited', 'First'),
      value: formatShortYearDate(firstDate),
      testID: 'section-first',
    },
    {
      label: t('sections.lastVisited', 'Last'),
      value: formatShortYearDate(lastDate),
      testID: 'section-last',
    },
  ];
  const bestLabel = t('sections.best', 'Best');
  const avgLabel = t('sections.avg', 'Avg');
  if (bothDirections) {
    const forwardDot = activityColor ?? colors.primary;
    const entries = [
      [bestLabel, forwardBest, 'section-best-forward', forwardDot],
      [bestLabel, reverseBest, 'section-best-reverse', REVERSE_COLOR],
      [avgLabel, forwardAvg, 'section-avg-forward', forwardDot],
      [avgLabel, reverseAvg, 'section-avg-reverse', REVERSE_COLOR],
    ] as const;
    for (const [label, value, testID, dotColor] of entries) {
      if (value) columns.push({ label, value, testID, dotColor });
    }
  } else {
    const best = forwardBest ?? reverseBest;
    const avg = forwardAvg ?? reverseAvg;
    if (best) columns.push({ label: bestLabel, value: best, testID: 'section-best' });
    if (avg) columns.push({ label: avgLabel, value: avg, testID: 'section-avg' });
  }

  const rows: (typeof columns)[] = [];
  for (let i = 0; i < columns.length; i += 2) rows.push(columns.slice(i, i + 2));

  return (
    <Card variant="flat">
      <Text style={[styles.title, { color: isDark ? darkColors.textPrimary : colors.textPrimary }]}>
        {t('recording.summary', 'Summary')}
      </Text>
      {rows.map((row, r) => (
        <View key={r} style={styles.row} testID={`section-summary-row-${r}`}>
          {row.map((col, i) => (
            <View key={i} style={styles.column} testID={`section-summary-cell-${r}-${i}`}>
              <View style={styles.labelRow}>
                {col.dotColor && <View style={[styles.dot, { backgroundColor: col.dotColor }]} />}
                <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>
                  {col.label}
                </Text>
              </View>
              <Text
                testID={col.testID}
                style={[styles.value, { color: valueColor }]}
                numberOfLines={1}
              >
                {col.value}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginBottom: spacing.xxs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
  },
  label: {
    fontSize: typography.caption.fontSize,
  },
  value: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
});
