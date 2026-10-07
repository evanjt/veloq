import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Alert, LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import { useActivityBoundsCache } from '@/features/activity';
import { useRouteGroups, useSectionSummaries, useRouteSettings } from '@/features/routes';
import { useTheme } from '@/shared/app';
import { formatFullDate } from '@/shared/format/format';
import { formatDaySpan, type SpanTranslator } from '@/shared/format/daySpan';
import { estimateRoutesDatabaseSize, getAthleteFilesSize } from '@/shared/storage/gpsStorage';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import {
  clearHeatmapTileSets,
  clearUnpinnedBasemapTiles,
  clearTerrainPreviews,
  getTerrainPreviewCacheSize,
  HEATMAP_TILES_DIR,
  readBasemapTileSizes,
  readHeatmapTilesCacheSize,
  type BasemapTileSizes,
} from '@/features/maps';
import { engineErrorKey } from '@/shared/native/engineError';
import { EngineReadFailure } from '@/shared/ui/EngineReadFailure';
import { useQueryCacheCount } from '../hooks/useQueryCacheCount';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { CacheManagementPanel } from './CacheManagementPanel';
import { StorageStatsPanel } from './StorageStatsPanel';

function formatDateOrDash(dateStr: string | null): string {
  if (!dateStr) return '-';
  return formatFullDate(dateStr);
}

interface DataCacheSectionProps {
  onLayout?: (event: LayoutChangeEvent) => void;
}

export function DataCacheSection({ onLayout }: DataCacheSectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isDemoMode = useAuthStore((state) => state.isDemoMode);
  const queryClient = useQueryClient();

  const { cacheStats, clearCache } = useActivityBoundsCache();

  // Get sync state from global store
  const resetSyncDateRange = useSyncDateRange((s) => s.reset);

  // Route matching
  const {
    groups: routeGroups,
    processedCount: routeProcessedCount,
    error: routeGroupsError,
  } = useRouteGroups({
    minActivities: 2,
  });
  const { totalCount: totalSections, error: sectionsError } = useSectionSummaries();
  const { settings: routeSettings } = useRouteSettings();

  // Map cache figures. On both handsets every kept basemap tile lives in the
  // Rust store, so the tile figures are the store's. The page buckets are what
  // the web transport writes, and nothing here measures them.
  const [terrainCacheSize, setTerrainCacheSize] = useState(0);
  const [heatmapCacheSize, setHeatmapCacheSize] = useState(0);
  const [basemapTiles, setBasemapTiles] = useState<BasemapTileSizes | null>(null);
  const [athleteFilesSize, setAthleteFilesSize] = useState(0);
  const [freeStorage, setFreeStorage] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    getTerrainPreviewCacheSize().then(setTerrainCacheSize);
    // Walked on a Rust thread and polled: on the mount thread it was 170 ms
    // for 40,061 tiles, against a 100 ms budget for the whole screen.
    readHeatmapTilesCacheSize().then((bytes) => {
      if (live) setHeatmapCacheSize(bytes);
    });
    // On a Rust thread too: the first read of a session loads every source's
    // index, and a source without one is rebuilt by walking its tree.
    readBasemapTileSizes().then((sizes) => {
      if (live) setBasemapTiles(sizes);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    getAthleteFilesSize().then((bytes) => {
      if (live) setAthleteFilesSize(bytes);
    });
    return () => {
      live = false;
    };
  }, [cacheStats.totalActivities]);

  useEffect(() => {
    FileSystem.getFreeDiskStorageAsync()
      .then(setFreeStorage)
      .catch(() => setFreeStorage(null));
  }, []);

  const refreshBasemapTiles = useCallback(() => {
    readBasemapTileSizes().then(setBasemapTiles);
  }, []);

  const handleClearMapCache = useCallback(async () => {
    await clearTerrainPreviews();
    const tilesCleared = await clearHeatmapTileSets([HEATMAP_TILES_DIR]);
    await clearUnpinnedBasemapTiles();
    refreshBasemapTiles();
    setTerrainCacheSize(0);
    if (tilesCleared) {
      setHeatmapCacheSize(0);
    } else {
      readHeatmapTilesCacheSize().then(setHeatmapCacheSize);
      Alert.alert(t('alerts.error'), t('alerts.failedToClear'));
    }
  }, [t, refreshBasemapTiles]);

  // Memoized date range text for cache stats (prevents Date parsing on every render)
  // `t` is rebuilt whenever the language changes, so it also re-keys the locale
  // `formatFullDate` reads.
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
    return `${formatDateOrDash(cacheStats.oldestDate)} - ${formatDateOrDash(cacheStats.newestDate)} (${formatDaySpan(days, t as SpanTranslator)})`;
  }, [cacheStats.oldestDate, cacheStats.newestDate, t]);

  const totalQueries = useQueryCacheCount(queryClient);

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
            // 1. Cancel any in-flight queries
            await queryClient.cancelQueries();

            // 2. Reset sync date range to 90 days FIRST (changes query keys)
            resetSyncDateRange();

            // 3. Clear all caches (engine, tiles, filesystem)
            const cleared = await clearCache();
            await clearTerrainPreviews();
            await clearUnpinnedBasemapTiles();
            refreshBasemapTiles();
            const tilesCleared = await clearHeatmapTileSets([HEATMAP_TILES_DIR]);
            setTerrainCacheSize(0);
            setHeatmapCacheSize(tilesCleared ? 0 : await readHeatmapTilesCacheSize());

            // 4. Yield to let GlobalDataSync re-render with new 90-day date range
            await new Promise((resolve) => setTimeout(resolve, 200));

            // 5. Force active queries to refetch fresh data.
            // DO NOT use clear() - it destroys observers.
            // DO NOT use invalidateQueries() - it only marks stale, doesn't actively fetch.
            // refetchQueries() actively fetches all mounted queries regardless of state.
            await queryClient.refetchQueries();

            // Refresh cache sizes
            refreshCacheSizes();

            // Heat left on disk is not a cleared cache, whatever the wipe said.
            if (!tilesCleared) {
              Alert.alert(t('alerts.error'), t('alerts.failedToClear'));
            } else {
              Alert.alert(cleared ? t('alerts.cacheCleared') : t('settings.stillRunning'));
            }
          } catch (error) {
            // Which failure it was, where the engine said. "Not open yet" and
            // "the database refused" were one line, and neither told the
            // athlete what to do next.
            Alert.alert(t('alerts.error'), t(engineErrorKey(error, 'alerts.failedToClear')));
          }
        },
      },
    ]);
  }, [t, queryClient, resetSyncDateRange, clearCache, refreshCacheSizes, refreshBasemapTiles]);

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
          onClearCache={handleClearCache}
        />

        {routeGroupsError !== undefined || sectionsError !== undefined ? (
          <EngineReadFailure
            error={routeGroupsError ?? sectionsError}
            testID="route-counts-failure"
          />
        ) : null}

        <StorageStatsPanel
          isDark={isDark}
          totalActivities={cacheStats.totalActivities}
          routeGroupCount={routeGroups.length}
          totalSections={totalSections}
          routeMatchingEnabled={routeSettings.enabled}
          dateRangeText={dateRangeText}
          lastSync={cacheStats.lastSync}
          totalQueries={totalQueries}
          onClearMapCache={handleClearMapCache}
          routesSize={cacheSizes.routes}
          basemapTiles={basemapTiles}
          terrainCacheSize={terrainCacheSize}
          heatmapCacheSize={heatmapCacheSize}
          athleteFilesSize={athleteFilesSize}
          freeStorage={freeStorage}
          onBudgetApplied={refreshBasemapTiles}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: typography.caption.fontSize,
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
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
