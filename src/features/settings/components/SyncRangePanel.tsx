import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { TimelineSlider } from '@/features/maps/components';
import { useActivityBoundsCache } from '@/features/activity/hooks';
import { useTheme } from '@/shared/app';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { formatLocalDate, formatFileSize } from '@/shared/format/format';
import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { getEngine } from '@/shared/native/engine';
import { HEATMAP_TILES_DIR, getHeatmapTilesCacheSize } from '@/features/maps/hooks/useHeatmapTiles';
import { settingsStyles } from './settingsStyles';
import { brand, colors, colorWithOpacity, darkColors, spacing, typography } from '@/theme';

export function SyncRangePanel() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // --- Heatmap toggle state ---
  const heatmapEnabled = useRouteSettings((s) => s.settings.heatmapEnabled);
  const setHeatmapEnabled = useRouteSettings((s) => s.setHeatmapEnabled);
  const [heatmapSize, setHeatmapSize] = useState(0);

  const refreshHeatmapSize = useCallback(() => {
    setHeatmapSize(getHeatmapTilesCacheSize());
  }, []);

  useEffect(() => {
    refreshHeatmapSize();
  }, [refreshHeatmapSize, heatmapEnabled]);

  const handleHeatmapToggle = useCallback(
    (enabled: boolean) => {
      setHeatmapEnabled(enabled);
      const engine = getEngine();
      if (enabled) {
        engine?.enableHeatmapTiles();
      } else {
        engine?.clearHeatmapTiles(HEATMAP_TILES_DIR);
        const legacyDir = `${FileSystem.documentDirectory}heatmap-tiles/`;
        engine?.clearHeatmapTiles(legacyDir);
        engine?.disableHeatmapTiles();
      }
      refreshHeatmapSize();
    },
    [setHeatmapEnabled, refreshHeatmapSize]
  );

  // --- Data range state ---
  const { progress, cacheStats, syncDateRange } = useActivityBoundsCache();
  const { data: apiOldestDate } = useOldestActivityDate();

  const syncOldest = useSyncDateRange((s) => s.oldest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);
  const gpsSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);

  const cachedStartDate = useMemo(() => {
    if (isExpansionLocked) return new Date(syncOldest);
    if (cacheStats.oldestDate) {
      const cacheOldest = new Date(cacheStats.oldestDate);
      const syncStart = new Date(syncOldest);
      return cacheOldest < syncStart ? cacheOldest : syncStart;
    }
    return new Date(syncOldest);
  }, [cacheStats.oldestDate, syncOldest, isExpansionLocked]);

  const cachedEndDate = useMemo(() => new Date(), []);

  const isSyncing = progress.status === 'syncing' || isGpsSyncing || isFetchingExtended;

  const { minDateForSlider, maxDateForSlider } = useMemo(() => {
    const now = new Date();
    if (apiOldestDate) {
      return { minDateForSlider: new Date(apiOldestDate), maxDateForSlider: now };
    }
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return { minDateForSlider: d, maxDateForSlider: now };
  }, [apiOldestDate]);

  const handleRangeChange = useCallback(
    (start: Date, _end: Date) => {
      if (start < cachedStartDate) {
        syncDateRange(formatLocalDate(start), formatLocalDate(new Date()));
      }
    },
    [syncDateRange, cachedStartDate]
  );

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.localDataRange').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {/* Heatmap toggle */}
        <View style={settingsStyles.actionRow}>
          <MaterialCommunityIcons
            name="map-legend"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <View style={styles.toggleTextWrap}>
            <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
              {t('settings.heatmapGeneration', 'Heatmap')}
            </Text>
            <Text style={[styles.toggleHint, isDark && settingsStyles.textMuted]}>
              {heatmapEnabled && heatmapSize > 0
                ? t('settings.heatmapStorageUsed', {
                    defaultValue: 'Using {{size}} of device storage',
                    size: formatFileSize(heatmapSize),
                  })
                : t('settings.heatmapDescription', 'Uses device storage. Disable to save space.')}
            </Text>
          </View>
          <Switch
            value={heatmapEnabled}
            onValueChange={handleHeatmapToggle}
            color={colors.primary}
          />
        </View>

        <View style={[settingsStyles.fullDivider, isDark && settingsStyles.fullDividerDark]} />

        {/* Timeline slider */}
        <View style={styles.sliderWrap}>
          <TimelineSlider
            minDate={minDateForSlider}
            maxDate={maxDateForSlider}
            startDate={cachedStartDate}
            endDate={cachedEndDate}
            onRangeChange={handleRangeChange}
            isLoading={isSyncing}
            activityCount={cacheStats.totalActivities}
            cachedOldest={null}
            cachedNewest={null}
            isDark={isDark}
            showActivityFilter={false}
            showCachedRange={false}
            showLegend={false}
            showSyncBanner={false}
            fixedEnd
            expandOnly
          />
        </View>

        {/* GPS sync progress */}
        {isSyncing || isFetchingExtended ? (
          <View style={[styles.progressRow, isDark && styles.progressRowDark]}>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.max(gpsSyncProgress.percent, 2)}%` },
                ]}
              />
            </View>
            <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
              {gpsSyncProgress.message ||
                (isFetchingExtended
                  ? t('cache.fetchingActivities', 'Fetching activities...')
                  : t('common.loading'))}
              {gpsSyncProgress.total > 0 &&
                ` (${gpsSyncProgress.completed}/${gpsSyncProgress.total})`}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  toggleTextWrap: {
    flex: 1,
  },
  toggleHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sliderWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  progressRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colorWithOpacity(brand.tealLight, 0.06),
  },
  progressRowDark: {
    backgroundColor: colorWithOpacity(brand.tealLight, 0.1),
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
  actionRowDisabled: {
    opacity: 0.5,
  },
  spinner: {
    width: 22,
    height: 22,
  },
  resultText: {
    fontSize: 12,
    color: colors.primary,
  },
  resultTextDark: {
    color: colors.primary,
  },
});
