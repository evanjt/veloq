/**
 * InsightfulStats - Activity stats display with a detail sheet.
 *
 * Refactored to use extracted components:
 * - useActivityStats: Stats computation hook
 * - StatCard: Individual stat card display
 * - StatDetailSheet: the detail of one stat, shown in the stat sheet route
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { INTERVALS_URLS } from '@/shared/app/constants';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { openExternal } from '@/shared/app/openExternal';
import { colors, spacing } from '@/theme';
import type { Activity, WellnessData } from '@/types';
import type { ActivityFitnessImpact, ActivitySummary, MaxHrSource } from 'veloqrs';
import { useActivityStats } from './useActivityStats';
import { StatCard } from './StatCard';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui';
import type { StatDetail } from './types';
import type { ActivityNewGround } from '../../hooks/useActivitySectionHighlights';

interface InsightfulStatsProps {
  activity: Activity;
  /** Wellness data for the activity date (for context) */
  wellness?: WellnessData | null | undefined;
  /** The max HR from the detail screen read, the one the zones chart divides by. */
  maxHR?: number | undefined;
  /** Where `maxHR` came from, from the same read. */
  maxHrSource?: MaxHrSource | undefined;
  fitnessImpact?: ActivityFitnessImpact | null | undefined;
  newGround?: ActivityNewGround | undefined;
  /** The stored summary from the detail screen read. */
  summary?: ActivitySummary | undefined;
  /** The intervals.icu id the detail read names. Without one there is no page to link to. */
  intervalsId?: string | null | undefined;
}

export function InsightfulStats({
  activity,
  wellness,
  maxHR,
  maxHrSource,
  fitnessImpact,
  newGround,
  summary,
  intervalsId,
}: InsightfulStatsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const openSheet = useSheetOpener();

  // Use extracted hook for stats computation
  const isMetric = useMetricSystem();
  const { stats } = useActivityStats({
    activity,
    wellness,
    isDark,
    isMetric,
    maxHR,
    maxHrSource,
    fitnessImpact,
    newGround,
    summary,
  });

  const handleStatPress = useCallback(
    (stat: StatDetail) => {
      void openSheet<StatDetail, never>('sheets/stat-detail', stat);
    },
    [openSheet]
  );

  // Open activity in intervals.icu website
  const openInIntervalsICU = useCallback(() => {
    if (!intervalsId) return;
    void openExternal(INTERVALS_URLS.activityPage(intervalsId));
  }, [intervalsId]);

  if (stats.length === 0) return null;

  return (
    <View style={styles.frame} testID="activity-stats-grid">
      <Card
        variant="raised"
        title={t('activity.activityStats')}
        titleAccessory={
          intervalsId ? (
            <Button
              label={t('activity.viewInIntervalsICU')}
              variant="ghost"
              size="sm"
              onPress={openInIntervalsICU}
              icon={<MaterialCommunityIcons name="open-in-new" size={14} color={colors.primary} />}
            />
          ) : undefined
        }
      >
        <View style={styles.statsGrid}>
          {stats.map((stat, index) => (
            <StatCard key={index} stat={stat} isDark={isDark} onPress={handleStatPress} />
          ))}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
