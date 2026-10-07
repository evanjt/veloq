/**
 * InsightfulStats - Activity stats display with detail modals.
 *
 * Refactored to use extracted components:
 * - useActivityStats: Stats computation hook
 * - StatCard: Individual stat card display
 * - StatDetailModal: Modal for detailed stat info
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { colors, typography, spacing } from '@/theme';
import type { Activity, WellnessData } from '@/types';
import type { ActivityFitnessImpact } from 'veloqrs';
import { DEFAULT_MAX_HR } from '../../lib/hrZones';
import { useActivityStats } from './useActivityStats';
import { StatCard } from './StatCard';
import { StatDetailModal } from './StatDetailModal';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui';
import type { StatDetail } from './types';
import type { ActivityNewGround } from '../../hooks/useActivitySectionHighlights';

interface InsightfulStatsProps {
  activity: Activity;
  /** Wellness data for the activity date (for context) */
  wellness?: WellnessData | null | undefined;
  /** The max HR from the detail screen read, the one the zones chart divides by. Without one, the default. */
  maxHR?: number | undefined;
  fitnessImpact?: ActivityFitnessImpact | null | undefined;
  newGround?: ActivityNewGround | undefined;
}

export function InsightfulStats({
  activity,
  wellness,
  maxHR,
  fitnessImpact,
  newGround,
}: InsightfulStatsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [selectedStat, setSelectedStat] = useState<StatDetail | null>(null);

  // Use extracted hook for stats computation
  const isMetric = useMetricSystem();
  const { stats } = useActivityStats({
    activity,
    wellness,
    isDark,
    isMetric,
    maxHR: maxHR ?? DEFAULT_MAX_HR,
    fitnessImpact,
    newGround,
  });

  const handleStatPress = useCallback((stat: StatDetail) => {
    setSelectedStat(stat);
  }, []);

  const closeModal = useCallback(() => {
    setSelectedStat(null);
  }, []);

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
      <Card variant="raised">
        <View style={styles.headerRow}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
            {t('activity.activityStats')}
          </Text>
          <Button
            label={t('activity.viewInIntervalsICU')}
            variant="ghost"
            size="sm"
            onPress={openInIntervalsICU}
            icon={<MaterialCommunityIcons name="open-in-new" size={14} color={colors.primary} />}
          />
        </View>

        <View style={styles.statsGrid}>
          {stats.map((stat, index) => (
            <StatCard key={index} stat={stat} isDark={isDark} onPress={handleStatPress} />
          ))}
        </View>

        <StatDetailModal stat={selectedStat} isDark={isDark} onClose={closeModal} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textLight: {
    color: colors.textOnDark,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
