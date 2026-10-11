/**
 * Summary card showing first/last visited dates and best/average times.
 * Displayed between the scatter chart and the calendar history.
 */

import { useMetricSystem } from '@/shared/app';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Card, Shimmer } from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import { formatAxisDate, formatDuration, formatPace, formatSwimPace } from '@/shared/format/format';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { DirectionStats, ActivityType } from '@/types';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';
import { DirectionArrow, directionWord, type SectionDirection } from './DirectionCue';

const INFO_CARD_PLACEHOLDER_HEIGHT = 96;
const REVERSE_COLOR = colors.reverseDirection;
const DIRECTION_ARROW_SIZE = 12;

export interface SectionInfoCardProps {
  /** The oldest included attempt in the range, as the engine dates it. */
  firstActivityDate: Date | null;
  /** The newest included attempt in the range, as the engine dates it. */
  lastActivityDate: Date | null;
  bestForwardRecord: SectionPerformanceRecord | null;
  bestReverseRecord: SectionPerformanceRecord | null;
  forwardStats: DirectionStats | null;
  reverseStats: DirectionStats | null;
  /** The sport on screen, absent until the engine has answered. */
  sportType: string | undefined;
  isDark: boolean;
  /** Colour of the forward direction's arrow. */
  activityColor?: string;
  /** Streams are still downloading, so the card holds its place. */
  pending?: boolean;
}

export function SectionInfoCard({
  firstActivityDate: firstDate,
  lastActivityDate: lastDate,
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

  const columns: {
    label: string;
    value: string;
    testID?: string;
    direction?: SectionDirection;
    arrowColor?: string;
  }[] = [
    {
      label: t('sections.firstVisited', 'First'),
      value: formatAxisDate(firstDate, false),
      testID: 'section-first',
    },
    {
      label: t('sections.lastVisited', 'Last'),
      value: formatAxisDate(lastDate, false),
      testID: 'section-last',
    },
  ];
  const bestLabel = t('sections.best', 'Best');
  const avgLabel = t('sections.avg', 'Avg');
  if (bothDirections) {
    const forwardColor = activityColor ?? colors.primary;
    const entries = [
      [bestLabel, forwardBest, 'section-best-forward', 'forward', forwardColor],
      [bestLabel, reverseBest, 'section-best-reverse', 'reverse', REVERSE_COLOR],
      [avgLabel, forwardAvg, 'section-avg-forward', 'forward', forwardColor],
      [avgLabel, reverseAvg, 'section-avg-reverse', 'reverse', REVERSE_COLOR],
    ] as const;
    for (const [label, value, testID, direction, arrowColor] of entries) {
      if (value) {
        columns.push({
          label: `${label} · ${directionWord(t, direction)}`,
          value,
          testID,
          direction,
          arrowColor,
        });
      }
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
                {col.direction && col.arrowColor && (
                  <DirectionArrow
                    direction={col.direction}
                    color={col.arrowColor}
                    size={DIRECTION_ARROW_SIZE}
                  />
                )}
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
  label: {
    fontSize: typography.caption.fontSize,
  },
  value: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
});
