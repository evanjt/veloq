import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Alert, LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {
  useActivityBoundsCache,
  useRouteProcessing,
  useRouteGroups,
  useOldestActivityDate,
  useTheme,
  useSectionSummaries,
} from '@/hooks';
import { formatLocalDate, formatFullDate } from '@/lib';
import { estimateRoutesDatabaseSize } from '@/lib';
import { useAuthStore, useRouteSettings, useSyncDateRange } from '@/providers';
import { useTileCacheStore } from '@/providers/TileCacheStore';
import {
  emitClearTileCache,
  requestTileCacheStats,
  onTileCacheStats,
  type TileCacheStats,
} from '@/lib/events/terrainSnapshotEvents';
import {
  clearTerrainPreviews,
  getTerrainPreviewCacheSize,
} from '@/lib/storage/terrainPreviewCache';
import * as TileCacheService from '@/lib/maps/tileCacheService';
import { HEATMAP_TILES_DIR, getHeatmapTilesCacheSize } from '@/hooks/maps/useHeatmapTiles';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { colors, darkColors, spacing, layout } from '@/theme';
import { CacheManagementPanel } from './CacheManagementPanel';
import { StorageStatsPanel } from './StorageStatsPanel';
import { TileCachePanel } from './TileCachePanel';

function formatDateOrDash(dateStr: string | null): string {
  if (!dateStr) return '-';
  return formatFullDate(dateStr);
}

interface DataCacheSectionProps {
  onLayout?: (event: LayoutChangeEvent) => void;
}

export function DataCacheSection({ onLayout }: DataCacheSectionProps) {
  const { isDark } = useTheme();
  const { t, i18n } = useTranslation();
  const isDemoMode = useAuthStore((state) => state.isDemoMode);
  const queryClient = useQueryClient();

  const { progress, cacheStats, clearCache, syncDateRange } = useActivityBoundsCache();
  const { data: apiOldestDate } = useOldestActivityDate();

  // Get sync state from global store
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);
  const resetSyncDateRange = useSyncDateRange((s) => s.reset);

  // Route matching
  const { isProcessing: isRouteProcessing, cancel: cancelRouteProcessing } = useRouteProcessing();
  const { groups: routeGroups, processedCount: routeProcessedCount } = useRouteGroups({
    minActivities: 2,
  });
  const { totalCount: totalSections } = useSectionSummaries();
  const { settings: routeSettings, setEnabled: setRouteMatchingEnabled } = useRouteSettings();

  // Map tile cache stats
  const nativeSizeEstimate = useTileCacheStore((s) => s.nativeSizeEstimate);
  const [terrainCacheSize, setTerrainCacheSize] = useState(0);
  const [heatmapCacheSize, setHeatmapCacheSize] = useState(0);
  const [tileCacheStats, setTileCacheStats] = useState<TileCacheStats | null>(null);
  const [freeStorage, setFreeStorage] = useState<number | null>(null);

  useEffect(() => {
    getTerrainPreviewCacheSize().then(setTerrainCacheSize);
    getHeatmapTilesCacheSize().then(setHeatmapCacheSize);
  }, []);

  useEffect(() => {
    const unsub = onTileCacheStats(setTileCacheStats);
    requestTileCacheStats();
    const timeout = setTimeout(() => {
      setTileCacheStats((prev) => prev ?? null);
    }, 500);
    return () => {
      unsub();
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    FileSystem.getFreeDiskStorageAsync()
      .then(setFreeStorage)
      .catch(() => setFreeStorage(null));
  }, []);

  const totalMapCache =
    nativeSizeEstimate + terrainCacheSize + heatmapCacheSize + (tileCacheStats?.totalBytes ?? 0);

  const handleClearMapCache = useCallback(async () => {
    await clearTerrainPreviews();
    await TileCacheService.clearAllPacks();
    getRouteEngine()?.clearHeatmapTiles(HEATMAP_TILES_DIR);
    emitClearTileCache();
    setTerrainCacheSize(0);
    setHeatmapCacheSize(0);
    setTileCacheStats(null);
  }, []);

  // Memoized date range text for cache stats (prevents Date parsing on every render)
  const dateRangeText = useMemo(() => {
    if (!cacheStats.oldestDate || !cacheStats.newestDate) {
      return t('settings.noData');
    }
    const oldest = new Date(cacheStats.oldestDate);
    const newest = new Date(cacheStats.newestDate);
    // Use calendar days for accurate day counting
    const oldestDay = new Date(oldest.getFullYear(), oldest.getMonth(), oldest.getDate());
    const newestDay = new Date(newest.getFullYear(), newest.getMonth(), newest.getDate());
    const days =
      Math.round((newestDay.getTime() - oldestDay.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return `${formatDateOrDash(cacheStats.oldestDate)} - ${formatDateOrDash(cacheStats.newestDate)} (${t('stats.daysCount', { count: days })})`;
  }, [cacheStats.oldestDate, cacheStats.newestDate, t, i18n.language]);

  // Timeline slider state - reflects actual cached data range
  // Start date tracks the oldest loaded activity date (only expands left)
  // End date is always "now" (fixed at right edge)
  const cachedStartDate = useMemo(() => {
    // After a reset, isExpansionLocked is true - use the sync store's 90-day range
    // This prevents showing stale cache data during the reset transition
    if (isExpansionLocked) {
      return new Date(syncOldest);
    }
    // Normal operation: show the OLDER (more expanded) of the two dates
    // This prevents snap-back when user drags to expand but data hasn't loaded yet
    if (cacheStats.oldestDate) {
      const cacheOldest = new Date(cacheStats.oldestDate);
      const syncStart = new Date(syncOldest);
      // Return the earlier date (smaller timestamp = further in the past)
      return cacheOldest < syncStart ? cacheOldest : syncStart;
    }
    // Fallback to sync store oldest if no cached data yet
    return new Date(syncOldest);
  }, [cacheStats.oldestDate, syncOldest, isExpansionLocked]);

  const cachedEndDate = useMemo(() => {
    // End date is always now (today) - fixed at right edge
    return new Date();
  }, []);

  // Combined syncing state
  const isSyncing = progress.status === 'syncing' || isGpsSyncing || isFetchingExtended;

  // Calculate min/max dates for slider
  const { minDateForSlider, maxDateForSlider } = useMemo(() => {
    const now = new Date();

    // Use the oldest activity date from API if available
    if (apiOldestDate) {
      return {
        minDateForSlider: new Date(apiOldestDate),
        maxDateForSlider: now,
      };
    }

    // Fallback: 90 days ago
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return { minDateForSlider: d, maxDateForSlider: now };
  }, [apiOldestDate]);

  // Handle date range change from timeline slider
  // Only allow expansion - start can only go earlier (left), end is fixed at "now"
  const handleRangeChange = useCallback(
    (start: Date, _end: Date) => {
      // Only allow expansion to earlier dates
      if (start < cachedStartDate) {
        // Trigger sync for the expanded date range (end is always "now")
        syncDateRange(formatLocalDate(start), formatLocalDate(new Date()));
      }
    },
    [syncDateRange, cachedStartDate]
  );

  // Compute query cache stats
  const queryCacheStats = useMemo(() => {
    const queries = queryClient.getQueryCache().getAll();
    return {
      activities: queries.filter(
        (q) => q.queryKey[0] === 'activities' || q.queryKey[0] === 'activities-infinite'
      ).length,
      wellness: queries.filter((q) => q.queryKey[0] === 'wellness').length,
      curves: queries.filter((q) => q.queryKey[0] === 'powerCurve' || q.queryKey[0] === 'paceCurve')
        .length,
      totalQueries: queries.length,
    };
  }, [queryClient]); // Only recompute when queryClient changes, not on every activity sync

  // Cache sizes state (only routes database now, bounds/GPS are in SQLite)
  const [cacheSizes, setCacheSizes] = useState<{ routes: number }>({
    routes: 0,
  });

  // Fetch cache sizes on mount and when caches change
  // Note: callback is intentionally stable (no deps) - it always fetches fresh data
  const refreshCacheSizes = useCallback(async () => {
    const routes = await estimateRoutesDatabaseSize();
    setCacheSizes({ routes });
  }, []);

  useEffect(() => {
    refreshCacheSizes();
  }, [refreshCacheSizes, cacheStats.totalActivities, routeProcessedCount]);

  const handleClearCache = useCallback(() => {
    Alert.alert(t('alerts.clearCacheTitle'), t('alerts.clearCacheMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('alerts.clearReload'),
        style: 'destructive',
        onPress: async () => {
          try {
            // 1. Cancel any in-flight queries FIRST to stop ongoing fetches
            await queryClient.cancelQueries();

            // 2. Reset sync date range to 90 days and LOCK expansion
            // The expansion lock prevents any expandRange() calls from re-expanding
            resetSyncDateRange();

            // 3. CRITICAL: Yield to allow React to re-render GlobalDataSync with new date range
            // Without this, removeQueries() triggers refetch before GlobalDataSync has the new
            // 90-day syncOldest/syncNewest values, causing it to fetch the old extended range.
            await new Promise((resolve) => setTimeout(resolve, 0));

            // 4. Clear GPS/bounds cache and route cache BEFORE removing queries
            // This ensures the engine is empty before any new queries start
            // Note: clearCache() already calls engine.clear(), so don't call route clearCache
            // as that would emit a second 'syncReset' event and trigger duplicate syncs
            await clearCache();
            await clearTerrainPreviews();
            await TileCacheService.clearAllPacks();
            emitClearTileCache();
            getRouteEngine()?.clearHeatmapTiles(HEATMAP_TILES_DIR);
            setTerrainCacheSize(0);
            setHeatmapCacheSize(0);
            setTileCacheStats(null);

            // 5. Remove all cached query data
            // Now GlobalDataSync has the new 90-day range, so any refetch uses correct dates
            queryClient.removeQueries({ queryKey: ['activities'] });
            queryClient.removeQueries({ queryKey: ['activities-infinite'] });
            queryClient.removeQueries({ queryKey: ['wellness'] });
            queryClient.removeQueries({ queryKey: ['powerCurve'] });
            queryClient.removeQueries({ queryKey: ['paceCurve'] });
            queryClient.removeQueries({ queryKey: ['athlete'] });
            await AsyncStorage.removeItem('veloq-query-cache');

            // 6. Invalidate ALL queries to trigger fresh fetches
            queryClient.invalidateQueries({ queryKey: ['activities'] });
            queryClient.invalidateQueries({ queryKey: ['activities-infinite'] });
            queryClient.invalidateQueries({ queryKey: ['wellness'] });
            queryClient.invalidateQueries({ queryKey: ['powerCurve'] });
            queryClient.invalidateQueries({ queryKey: ['paceCurve'] });
            queryClient.invalidateQueries({ queryKey: ['athlete'] });
            queryClient.invalidateQueries({ queryKey: ['athlete-summary'] });

            // Refresh cache sizes
            refreshCacheSizes();
          } catch {
            Alert.alert(t('alerts.error'), t('alerts.failedToClear'));
          }
        },
      },
    ]);
  }, [t, queryClient, resetSyncDateRange, clearCache, refreshCacheSizes]);

  return (
    <>
      {/* Data Cache Section - Consolidated */}
      <View onLayout={onLayout}>
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('settings.dataCache').toUpperCase()}
        </Text>
      </View>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        <CacheManagementPanel
          isDark={isDark}
          isDemoMode={isDemoMode}
          minDate={minDateForSlider}
          maxDate={maxDateForSlider}
          startDate={cachedStartDate}
          endDate={cachedEndDate}
          onRangeChange={handleRangeChange}
          isSyncing={isSyncing}
          activityCount={cacheStats.totalActivities}
          routeMatchingEnabled={routeSettings.enabled}
          isRouteProcessing={isRouteProcessing}
          onCancelRouteProcessing={cancelRouteProcessing}
          onClearCache={handleClearCache}
        />

        <StorageStatsPanel
          isDark={isDark}
          totalActivities={cacheStats.totalActivities}
          routeGroupCount={routeGroups.length}
          totalSections={totalSections}
          routeMatchingEnabled={routeSettings.enabled}
          dateRangeText={dateRangeText}
          lastSync={cacheStats.lastSync}
          totalQueries={queryCacheStats.totalQueries}
          databaseSize={cacheSizes.routes}
          totalMapCache={totalMapCache}
          onClearMapCache={handleClearMapCache}
          routesSize={cacheSizes.routes}
          nativeSizeEstimate={nativeSizeEstimate}
          tileCacheStats={tileCacheStats}
          terrainCacheSize={terrainCacheSize}
          heatmapCacheSize={heatmapCacheSize}
          freeStorage={freeStorage}
        />

        <View style={[styles.divider, isDark && styles.dividerDark]} />

        <TileCachePanel
          isDark={isDark}
          routeMatchingEnabled={routeSettings.enabled}
          onRouteMatchingChange={setRouteMatchingEnabled}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 22 + spacing.sm, // icon + gap
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
