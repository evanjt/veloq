import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { ActivityDetail } from '@/types';
import { formatDateTime } from '@/shared/format/format';
import { colors, darkColors, spacing, typography, stroke } from '@/theme';
import { activityHeroStats } from '../lib/activityHeroStats';

interface ActivitySummaryStripProps {
  activity: ActivityDetail;
  isMetric: boolean;
  isDark: boolean;
}

const STAT_TEST_IDS = [
  'activity-summary-distance',
  'activity-summary-duration',
  'activity-summary-elevation',
] as const;

/**
 * The date and stat line for an activity with no map hero to carry them, an
 * indoor ride or a pool swim. The name is already the navigation title.
 */
export function ActivitySummaryStrip({ activity, isMetric, isDark }: ActivitySummaryStripProps) {
  const { t } = useTranslation();
  const stats = activityHeroStats(activity, isMetric, t);
  const visible = stats
    .map((stat, index) => (stat ? { ...stat, testID: STAT_TEST_IDS[index] } : null))
    .filter((entry) => entry != null);

  return (
    <View
      testID="activity-summary-strip"
      style={[styles.container, isDark && styles.containerDark]}
    >
      <Text style={[styles.date, isDark && styles.secondaryDark]}>
        {formatDateTime(activity.start_date_local)}
      </Text>
      <View
        testID="activity-summary-stats"
        accessible
        accessibilityLabel={visible.map((entry) => entry.label).join(', ')}
        style={styles.statsRow}
      >
        {visible.map((entry, index) => (
          <React.Fragment key={entry.testID}>
            {index > 0 && (
              <Text
                style={[styles.divider, isDark && styles.secondaryDark]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                ·
              </Text>
            )}
            <Text testID={entry.testID} style={[styles.stat, isDark && styles.statDark]}>
              {entry.text}
            </Text>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: stroke.hairline,
    borderBottomColor: colors.border,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
    borderBottomColor: darkColors.border,
  },
  date: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
  secondaryDark: {
    color: darkColors.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  stat: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  statDark: {
    color: darkColors.textPrimary,
  },
  divider: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    marginHorizontal: spacing.xsPlus,
  },
});
