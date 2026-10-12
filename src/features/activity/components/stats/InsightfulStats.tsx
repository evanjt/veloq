/**
 * InsightfulStats - Activity stats display with a detail sheet.
 *
 * Refactored to use extracted components:
 * - useActivityStats: Stats computation hook
 * - StatCard: Individual stat card display
 * - StatDetailSheet: the detail of one stat, shown in the stat sheet route
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { colors, spacing } from '@/theme';
import type { Activity, WellnessData } from '@/types';
import type { ActivityFitnessImpact, MaxHrSource } from 'veloqrs';
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
}

export function InsightfulStats({
  activity,
  wellness,
  maxHR,
  maxHrSource,
  fitnessImpact,
  newGround,
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
  });

  const handleStatPress = useCallback(
    (stat: StatDetail) => {
      void openSheet<StatDetail, never>('sheets/stat-detail', stat);
    },
    [openSheet]
  );

  // Open activity in intervals.icu website
  const openInIntervalsICU = useCallback(async () => {
    const url = `https://intervals.icu/activities/${activity.id}`;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // Fallback to Linking if WebBrowser fails
      Linking.openURL(url);
    }
  }, [activity.id]);

  if (stats.length === 0) return null;

  return (
    <View style={styles.frame}>
      <Card
        variant="raised"
        title={t('activity.activityStats')}
        titleAccessory={
          <Button
            label={t('activity.viewInIntervalsICU')}
            variant="ghost"
            size="sm"
            onPress={openInIntervalsICU}
            icon={<MaterialCommunityIcons name="open-in-new" size={14} color={colors.primary} />}
          />
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
