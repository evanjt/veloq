/**
 * Summary card showing first/last visited dates and best/average times.
 * Displayed between the scatter chart and the calendar history.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { getIntlLocale, formatDuration, formatPace, isRunningActivity } from '@/lib';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import type { PerformanceDataPoint, DirectionStats, ActivityType } from '@/types';
import type { SectionPerformanceRecord } from '@/hooks/routes/useSectionPerformances';

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
  sportType: string;
  isDark: boolean;
}

export function SectionInfoCard({
  chartData,
  bestForwardRecord,
  bestReverseRecord,
  forwardStats,
  reverseStats,
  sportType,
  isDark,
}: SectionInfoCardProps) {
  const { t } = useTranslation();

  const isRunning = isRunningActivity(sportType as ActivityType);

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

  // Best time/pace across both directions
  const bestDisplay = useMemo(() => {
    const fwd = bestForwardRecord;
    const rev = bestReverseRecord;
    const best = fwd && rev ? (fwd.bestTime <= rev.bestTime ? fwd : rev) : (fwd ?? rev);
    if (!best) return null;
    return isRunning ? formatPace(best.bestPace) : formatDuration(best.bestTime);
  }, [bestForwardRecord, bestReverseRecord, isRunning]);

  // Average time/pace across both directions (weighted by count)
  const avgDisplay = useMemo(() => {
    const fwd = forwardStats;
    const rev = reverseStats;
    if (!fwd && !rev) return null;
    if (fwd && rev && fwd.avgTime != null && rev.avgTime != null) {
      const totalCount = fwd.count + rev.count;
      if (totalCount === 0) return null;
      const weightedAvg = (fwd.avgTime * fwd.count + rev.avgTime * rev.count) / totalCount;
      if (isRunning) {
        // Convert avg time to pace (m/s) using section distance from best record
        const dist = bestForwardRecord?.sectionDistance ?? bestReverseRecord?.sectionDistance;
        if (dist && dist > 0) {
          return formatPace(dist / weightedAvg);
        }
      }
      return formatDuration(weightedAvg);
    }
    const stats = fwd ?? rev;
    if (!stats || stats.avgTime == null) return null;
    if (isRunning) {
      const dist = bestForwardRecord?.sectionDistance ?? bestReverseRecord?.sectionDistance;
      if (dist && dist > 0) {
        return formatPace(dist / stats.avgTime);
      }
    }
    return formatDuration(stats.avgTime);
  }, [forwardStats, reverseStats, isRunning, bestForwardRecord, bestReverseRecord]);

  if (!firstDate || !lastDate) return null;

  const labelColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const valueColor = isDark ? darkColors.textPrimary : colors.textPrimary;

  const columns: { label: string; value: string }[] = [
    { label: t('sections.firstVisited', 'First'), value: formatShortYearDate(firstDate) },
    { label: t('sections.lastVisited', 'Last'), value: formatShortYearDate(lastDate) },
  ];
  if (bestDisplay) {
    columns.push({ label: t('sections.best', 'Best'), value: bestDisplay });
  }
  if (avgDisplay) {
    columns.push({ label: t('sections.avg', 'Avg'), value: avgDisplay });
  }

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <Text style={[styles.title, { color: isDark ? darkColors.textPrimary : colors.textPrimary }]}>
        {t('recording.summary', 'Summary')}
      </Text>
      <View style={styles.grid}>
        {columns.map((col, i) => (
          <View key={i} style={styles.column}>
            <Text style={[styles.label, { color: labelColor }]}>{col.label}</Text>
            <Text style={[styles.value, { color: valueColor }]}>{col.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  title: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    fontSize: typography.caption.fontSize,
    marginBottom: 2,
  },
  value: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
});
