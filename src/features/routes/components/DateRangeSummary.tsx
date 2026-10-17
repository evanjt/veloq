/**
 * DateRangeSummary - Shows the date range of cached activities with a link to expand
 *
 * Replaces the timeline slider on the routes page.
 * Shows all cached data by default, with an option to expand the date range in settings.
 */

import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { formatDateOrDash } from '@/shared/format/format';
import { colors, darkColors, duration, iconSize, spacing, stroke, typography } from '@/theme';
import { Button } from '@/shared/ui';
import { tapTo } from '@/shared/app/navigation';

interface DateRangeSummaryProps {
  activityCount: number;
  oldestDate: string | null;
  newestDate: string | null;
  isDark?: boolean;
  isLoading?: boolean;
  syncMessage?: string | null;
}

export function DateRangeSummary({
  activityCount,
  oldestDate,
  newestDate,
  isDark = false,
  isLoading = false,
  syncMessage,
}: DateRangeSummaryProps) {
  const { t } = useTranslation();
  const themeColors = isDark ? darkColors : colors;

  const handleExpandPress = () => {
    tapTo('/sync-settings');
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Sync message banner */}
      {syncMessage ? (
        <Animated.View
          entering={FadeIn.duration(duration.exit)}
          exiting={FadeOut.duration(duration.quick)}
          style={[styles.syncBanner, isDark && styles.syncBannerDark]}
        >
          <ActivityIndicator size="small" color={themeColors.primary} style={styles.syncIcon} />
          <Text style={[styles.syncText, isDark && styles.textSecondary]}>{syncMessage}</Text>
        </Animated.View>
      ) : null}

      {/* Summary row */}
      <View style={styles.summaryRow}>
        <View style={styles.dateInfo}>
          <View style={styles.countRow}>
            {isLoading ? (
              <ActivityIndicator size="small" color={themeColors.primary} style={styles.syncIcon} />
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
          icon={
            <MaterialCommunityIcons
              name="calendar-expand-horizontal"
              size={iconSize.md}
              color={themeColors.primary}
            />
          }
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
    backgroundColor: colors.background,
    borderBottomWidth: stroke.one,
    borderBottomColor: colors.border,
  },
  containerDark: {
    backgroundColor: darkColors.background,
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
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateInfo: {
    flex: 1,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dateText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
