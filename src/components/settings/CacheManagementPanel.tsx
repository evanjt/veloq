import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { TimelineSlider } from '@/components/maps';
import { colors, darkColors, spacing } from '@/theme';

interface SyncProgress {
  status: string;
  completed: number;
  total: number;
  percent: number;
  message: string;
}

export interface CacheManagementPanelProps {
  isDark: boolean;
  isDemoMode: boolean;
  /** Timeline slider */
  minDate: Date;
  maxDate: Date;
  startDate: Date;
  endDate: Date;
  onRangeChange: (start: Date, end: Date) => void;
  isSyncing: boolean;
  isFetchingExtended: boolean;
  syncProgress: SyncProgress;
  activityCount: number;
  /** Route processing */
  routeMatchingEnabled: boolean;
  isRouteProcessing: boolean;
  onCancelRouteProcessing: () => void;
  /** Clear cache */
  onClearCache: () => void;
}

export function CacheManagementPanel({
  isDark,
  isDemoMode,
  minDate,
  maxDate,
  startDate,
  endDate,
  onRangeChange,
  isSyncing,
  isFetchingExtended,
  syncProgress,
  activityCount,
  routeMatchingEnabled,
  isRouteProcessing,
  onCancelRouteProcessing,
  onClearCache,
}: CacheManagementPanelProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Timeline Slider for date range selection - simplified for settings */}
      {/* fixedEnd: right handle locked at "now", expandOnly: left handle can only move left */}
      {/* Sync progress is shown via global CacheLoadingBanner at top of screen */}
      <TimelineSlider
        minDate={minDate}
        maxDate={maxDate}
        startDate={startDate}
        endDate={endDate}
        onRangeChange={onRangeChange}
        isLoading={isSyncing}
        activityCount={activityCount}
        cachedOldest={null}
        cachedNewest={null}
        isDark={isDark}
        showActivityFilter={false}
        showCachedRange={false}
        showLegend={false}
        showSyncBanner={false}
        fixedEnd={true}
        expandOnly={true}
      />

      {/* Sync progress — shown during GPS download and route analysis */}
      {(isSyncing || isFetchingExtended) && (
        <View style={[styles.progressRow, isDark && styles.progressRowDark]}>
          <View style={styles.progressBarTrack}>
            <View
              style={[styles.progressBarFill, { width: `${Math.max(syncProgress.percent, 2)}%` }]}
            />
          </View>
          <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
            {syncProgress.message ||
              (isFetchingExtended
                ? t('cache.fetchingActivities', 'Fetching activities...')
                : t('common.loading'))}
            {syncProgress.total > 0 && ` (${syncProgress.completed}/${syncProgress.total})`}
          </Text>
        </View>
      )}

      <View style={[styles.divider, isDark && styles.dividerDark]} />

      {routeMatchingEnabled && isRouteProcessing && (
        <>
          <TouchableOpacity style={styles.actionRow} onPress={onCancelRouteProcessing}>
            <MaterialCommunityIcons name="pause-circle-outline" size={22} color={colors.warning} />
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {t('settings.pauseRouteProcessing')}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
          </TouchableOpacity>
          <View style={[styles.divider, isDark && styles.dividerDark]} />
        </>
      )}

      <TouchableOpacity
        testID="settings-clear-cache"
        style={[styles.actionRow, isDemoMode && styles.actionRowDisabled]}
        onPress={isDemoMode ? undefined : onClearCache}
        disabled={isDemoMode}
        activeOpacity={isDemoMode ? 1 : 0.2}
      >
        <MaterialCommunityIcons
          name="delete-outline"
          size={22}
          color={isDemoMode ? colors.textSecondary : colors.error}
        />
        <Text
          style={[
            styles.actionText,
            isDemoMode ? styles.actionTextDisabled : styles.actionTextDanger,
          ]}
        >
          {t('settings.clearAllReload')}
        </Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? darkColors.textMuted : colors.textSecondary}
        />
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionRowDisabled: {
    opacity: 0.5,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  actionTextDisabled: {
    color: colors.textSecondary,
  },
  actionTextDanger: {
    color: colors.error,
  },
  progressRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(252, 76, 2, 0.06)',
  },
  progressRowDark: {
    backgroundColor: 'rgba(252, 76, 2, 0.1)',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  progressTextDark: {
    color: darkColors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 22 + spacing.sm, // icon + gap
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
