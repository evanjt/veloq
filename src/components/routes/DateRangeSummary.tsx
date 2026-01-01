/**
 * DateRangeSummary - Shows the date range of cached activities with a link to expand
 *
 * Replaces the timeline slider on the routes page.
 * Shows all cached data by default, with an option to expand the date range in settings.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing } from '@/theme';

interface DateRangeSummaryProps {
  activityCount: number;
  oldestDate: string | null;
  newestDate: string | null;
  isDark?: boolean;
  isLoading?: boolean;
  syncMessage?: string | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
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
    // Navigate to settings with the route matching section
    router.push('/settings');
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Sync message banner */}
      {syncMessage && (
        <View style={[styles.syncBanner, isDark && styles.syncBannerDark]}>
          <MaterialCommunityIcons
            name="sync"
            size={16}
            color={themeColors.primary}
            style={styles.syncIcon}
          />
          <Text style={[styles.syncText, isDark && styles.textMuted]}>{syncMessage}</Text>
        </View>
      )}

      {/* Summary row */}
      <View style={styles.summaryRow}>
        <View style={styles.dateInfo}>
          <Text style={[styles.countText, isDark && styles.textLight]}>
            {isLoading ? t('mapScreen.loadingActivities') : `${activityCount} activities`}
          </Text>
          {!isLoading && oldestDate && newestDate && (
            <Text style={[styles.dateText, isDark && styles.textMuted]}>
              {formatDate(oldestDate)} — {formatDate(newestDate)}
            </Text>
          )}
        </View>

        <Pressable style={styles.expandButton} onPress={handleExpandPress}>
          <MaterialCommunityIcons
            name="calendar-expand-horizontal"
            size={18}
            color={themeColors.primary}
          />
          <Text style={[styles.expandText, { color: themeColors.primary }]}>
            {t('settings.syncAllHistory')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  containerDark: {
    backgroundColor: '#121212',
    borderBottomColor: '#333',
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
    fontSize: 13,
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
  countText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dateText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  expandText: {
    fontSize: 13,
    fontWeight: '500',
    marginLeft: spacing.xs,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
});
