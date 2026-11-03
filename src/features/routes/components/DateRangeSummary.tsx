/**
 * DateRangeSummary - Shows the date range of cached activities with a link to expand
 *
 * Replaces the timeline slider on the routes page.
 * Shows all cached data by default, with an option to expand the date range in settings.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { formatDateOrDash } from '@/shared/format/format';
import { colors, darkColors, duration, iconSize, spacing, stroke, typography } from '@/theme';
import { Button, Spinner } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { openHistoryRange } from '@/shared/app/historyRange';
import { useLargeText } from '@/shared/ui/useLargeText';

interface DateRangeSummaryProps {
  activityCount: number;
  oldestDate: string | null;
  newestDate: string | null;
  isDark?: boolean;
  isLoading?: boolean;
  /** Work moving now, shown beside an indicator. */
  syncMessage?: string | null;
  /** Work owed and held, shown still, so it does not read as running. */
  heldMessage?: string | null;
}

export function DateRangeSummary({
  activityCount,
  oldestDate,
  newestDate,
  isDark = false,
  isLoading = false,
  syncMessage,
  heldMessage,
}: DateRangeSummaryProps) {
  const { t } = useTranslation();
  const stacked = useLargeText();

  const handleExpandPress = () => {
    openHistoryRange();
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Sync message banner */}
      {syncMessage ? (
        <Animated.View
          testID="routes-sync-banner"
          entering={FadeIn.duration(duration.exit)}
          exiting={FadeOut.duration(duration.quick)}
          style={[styles.syncBanner, isDark && styles.syncBannerDark]}
        >
          <Spinner label={syncMessage} style={styles.syncIcon} />
          <Text style={[styles.syncText, isDark && styles.textSecondary]}>{syncMessage}</Text>
        </Animated.View>
      ) : heldMessage ? (
        <View testID="routes-held-banner" style={styles.syncBanner}>
          <Icon
            name="pause-circle-outline"
            size={iconSize.xs}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
            style={styles.syncIcon}
          />
          <Text style={[styles.syncText, isDark && styles.textSecondary]}>{heldMessage}</Text>
        </View>
      ) : null}

      {/* Summary row */}
      <View
        testID="routes-date-range-summary"
        style={[styles.summaryRow, stacked && styles.summaryRowStacked]}
      >
        <View style={[styles.dateInfo, stacked && styles.dateInfoStacked]}>
          <View style={styles.countRow}>
            {isLoading ? (
              <Spinner label={t('mapScreen.loadingActivities')} style={styles.syncIcon} />
            ) : null}
            <Text style={[styles.countText, isDark && styles.textLight]}>
              {isLoading
                ? t('mapScreen.loadingActivities')
                : t('sections.activitiesCount', { count: activityCount })}
            </Text>
          </View>
          {!isLoading && oldestDate && newestDate ? (
            <Text style={[styles.dateText, isDark && styles.textSecondary]}>
              {formatDateOrDash(oldestDate)} - {formatDateOrDash(newestDate)}
            </Text>
          ) : null}
        </View>

        <Button
          variant="ghost"
          size="sm"
          onPress={handleExpandPress}
          icon="calendar-expand-horizontal"
          label={t('routesScreen.expandDateRange')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfacePage,
    borderBottomWidth: stroke.one,
    borderBottomColor: colors.border,
  },
  containerDark: {
    backgroundColor: darkColors.surfacePage,
    borderBottomColor: darkColors.border,
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  syncBannerDark: {},
  syncIcon: {
    marginRight: spacing.xs,
  },
  syncText: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryRowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  dateInfo: {
    flex: 1,
  },
  dateInfoStacked: {
    // Takes its own height, not the leftover space of the column.
    flex: 0,
    alignSelf: 'stretch',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countText: {
    ...typography.bodySmallBold,
    color: colors.textPrimary,
  },
  dateText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  textLight: {
    color: colors.textOnFill,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
