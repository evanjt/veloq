import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  LayoutChangeEvent,
} from 'react-native';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { router, Href, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useAthlete,
  useActivityBoundsCache,
  useRouteProcessing,
  useRouteGroups,
  useOldestActivityDate,
  useTheme,
  useUnifiedSections,
  useExportBackup,
  useImportBackup,
  useBulkExport,
} from '@/hooks';
import { TimelineSlider } from '@/components/maps';
import { formatLocalDate, formatFullDate } from '@/lib';
import { estimateRoutesDatabaseSize, clearAllAppCaches } from '@/lib';
import {
  getThemePreference,
  setThemePreference,
  useAuthStore,
  useSportPreference,
  useRouteSettings,
  useLanguageStore,
  useSyncDateRange,
  useUnitPreference,
  type ThemePreference,
  type PrimarySport,
  type UnitPreference,
} from '@/providers';
import { colors, darkColors, spacing, layout } from '@/theme';
import {
  ProfileSection,
  DisplaySettings,
  MapsSection,
  SummaryCardSection,
  AccountSection,
  DataSourcesSection,
  SupportSection,
} from '@/components/settings';

function formatDateOrDash(dateStr: string | null): string {
  if (!dateStr) return '-';
  return formatFullDate(dateStr);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('SettingsScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t, i18n } = useTranslation();
  const { isDark } = useTheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [showLanguages, setShowLanguages] = useState(false);
  const { exportBackup, exporting: backupExporting } = useExportBackup();
  const { importBackup, importing: backupImporting } = useImportBackup();
  const {
    exportAll,
    isExporting: bulkExporting,
    phase: bulkPhase,
    current: bulkCurrent,
    total: bulkTotal,
    sizeBytes: bulkSizeBytes,
  } = useBulkExport();

  // Scroll-to-anchor support
  const { scrollTo } = useLocalSearchParams<{ scrollTo?: string }>();
  const scrollViewRef = useRef<ScrollView>(null);
  const dataCacheSectionY = useRef<number>(0);
  const hasScrolled = useRef(false);

  // Track data cache section position
  const handleDataCacheSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      dataCacheSectionY.current = event.nativeEvent.layout.y;
      // Scroll if we haven't yet and have a scroll target
      if (scrollTo === 'cache' && !hasScrolled.current && scrollViewRef.current) {
        hasScrolled.current = true;
        // Small delay to ensure layout is complete
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({
            y: dataCacheSectionY.current - 16,
            animated: true,
          });
        }, 100);
      }
    },
    [scrollTo]
  );

  const { data: athlete } = useAthlete();
  const isDemoMode = useAuthStore((state) => state.isDemoMode);
  const primarySport = useSportPreference((s) => s.primarySport);
  const setPrimarySport = useSportPreference((s) => s.setPrimarySport);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const unitPreference = useUnitPreference((s) => s.unitPreference);
  const setUnitPreference = useUnitPreference((s) => s.setUnitPreference);
  const intervalsPreferences = useUnitPreference((s) => s.intervalsPreferences);

  // Load saved theme preference on mount
  useEffect(() => {
    getThemePreference()
      .then(setThemePreferenceState)
      .catch(() => {
        // Default to system preference on error
        setThemePreferenceState('system');
      });
  }, []);

  const handleThemeChange = async (value: string) => {
    const preference = value as ThemePreference;
    setThemePreferenceState(preference);
    await setThemePreference(preference);
  };

  const handleSportChange = async (value: string) => {
    await setPrimarySport(value as PrimarySport);
  };

  const handleLanguageChange = async (value: string) => {
    await setLanguage(value);
  };

  const handleUnitChange = async (value: string) => {
    await setUnitPreference(value as UnitPreference);
  };

  // Get sync state from global store first
  const syncOldest = useSyncDateRange((s) => s.oldest);

  const { progress, cacheStats, clearCache, sync, syncDateRange } = useActivityBoundsCache();

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

  // Fetch oldest activity date from API for timeline extent
  const { data: apiOldestDate } = useOldestActivityDate();

  // Get additional sync state from global store
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);

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

  // Route matching cache
  const {
    progress: routeProgress,
    isProcessing: isRouteProcessing,
    clearCache: clearRouteCache,
    cancel: cancelRouteProcessing,
  } = useRouteProcessing();
  // Use minActivities: 2 to show actual routes (groups with 2+ activities), not signatures
  const { groups: routeGroups, processedCount: routeProcessedCount } = useRouteGroups({
    minActivities: 2,
  });

  // Get unified sections count (auto-detected + custom)
  const { count: totalSections } = useUnifiedSections();

  // Route matching settings
  const { settings: routeSettings, setEnabled: setRouteMatchingEnabled } = useRouteSettings();

  // TanStack Query cache for clearing and stats
  const queryClient = useQueryClient();

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

  // Get reset function from SyncDateRangeStore
  const resetSyncDateRange = useSyncDateRange((s) => s.reset);

  const handleClearCache = () => {
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
            // Note: clearCache() already calls engine.clear(), so don't call clearRouteCache()
            // as that would emit a second 'syncReset' event and trigger duplicate syncs
            await clearCache();

            // 5. Remove all cached query data
            // Now GlobalDataSync has the new 90-day range, so any refetch uses correct dates
            queryClient.removeQueries({ queryKey: ['activities'] });
            queryClient.removeQueries({ queryKey: ['activities-infinite'] });
            queryClient.removeQueries({ queryKey: ['wellness'] });
            queryClient.removeQueries({ queryKey: ['powerCurve'] });
            queryClient.removeQueries({ queryKey: ['paceCurve'] });
            queryClient.removeQueries({ queryKey: ['athlete'] });
            await AsyncStorage.removeItem('veloq-query-cache');

            // 6. Invalidate remaining queries to trigger fresh fetches
            queryClient.invalidateQueries({ queryKey: ['wellness'] });
            queryClient.invalidateQueries({ queryKey: ['powerCurve'] });
            queryClient.invalidateQueries({ queryKey: ['paceCurve'] });
            queryClient.invalidateQueries({ queryKey: ['athlete'] });
            // Activities will be auto-fetched by GlobalDataSync with new 90-day range

            // Refresh cache sizes
            refreshCacheSizes();
          } catch {
            Alert.alert(t('alerts.error'), t('alerts.failedToClear'));
          }
        },
      },
    ]);
  };

  const handleClearRouteCache = () => {
    Alert.alert(t('alerts.clearRouteCacheTitle'), t('alerts.clearRouteCacheMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('alerts.clearReload'),
        style: 'destructive',
        onPress: async () => {
          try {
            await clearRouteCache();
            // Cache cleared via Rust engine
            refreshCacheSizes();
          } catch {
            Alert.alert(t('alerts.error'), t('alerts.failedToClear'));
          }
        },
      },
    ]);
  };

  return (
    <ScreenSafeAreaView
      testID="settings-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      <ScrollView
        testID="settings-scrollview"
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
      >
        {/* Header with back button */}
        <View style={styles.header}>
          <TouchableOpacity
            testID="nav-back-button"
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isDark ? colors.textOnDark : colors.textPrimary}
            />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>
            {t('settings.title')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Profile Section - tap to open intervals.icu profile */}
        <View style={{ marginHorizontal: layout.screenPadding }}>
          <ProfileSection athlete={athlete} />
        </View>

        <SummaryCardSection />

        {/* Display Settings: Appearance, Units, Language, Primary Sport */}
        <DisplaySettings
          themePreference={themePreference}
          onThemeChange={handleThemeChange}
          unitPreference={unitPreference}
          onUnitChange={handleUnitChange}
          intervalsUnitPreference={intervalsPreferences}
          primarySport={primarySport}
          onSportChange={handleSportChange}
          language={language ?? 'en-GB'}
          onLanguageChange={handleLanguageChange}
          showLanguages={showLanguages}
          setShowLanguages={setShowLanguages}
        />

        <MapsSection />

        {/* Data Cache Section - Consolidated */}
        <View onLayout={handleDataCacheSectionLayout}>
          <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
            {t('settings.dataCache').toUpperCase()}
          </Text>
        </View>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          {/* Timeline Slider for date range selection - simplified for settings */}
          {/* fixedEnd: right handle locked at "now", expandOnly: left handle can only move left */}
          {/* Sync progress is shown via global CacheLoadingBanner at top of screen */}
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
            fixedEnd={true}
            expandOnly={true}
          />

          <View style={[styles.divider, isDark && styles.dividerDark]} />

          {routeSettings.enabled && isRouteProcessing && (
            <>
              <TouchableOpacity style={styles.actionRow} onPress={cancelRouteProcessing}>
                <MaterialCommunityIcons
                  name="pause-circle-outline"
                  size={22}
                  color={colors.warning}
                />
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
            onPress={isDemoMode ? undefined : handleClearCache}
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

          <View style={[styles.divider, isDark && styles.dividerDark]} />

          {/* Backup & Restore */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={exportBackup}
            disabled={backupExporting}
            activeOpacity={0.2}
          >
            <MaterialCommunityIcons name="cloud-upload-outline" size={22} color={colors.primary} />
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {backupExporting ? t('backup.exporting') : t('backup.exportBackup')}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
          </TouchableOpacity>
          <View style={[styles.divider, isDark && styles.dividerDark]} />
          <TouchableOpacity
            style={styles.actionRow}
            onPress={importBackup}
            disabled={backupImporting}
            activeOpacity={0.2}
          >
            <MaterialCommunityIcons
              name="cloud-download-outline"
              size={22}
              color={colors.primary}
            />
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {backupImporting ? t('backup.importing') : t('backup.importBackup')}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
          </TouchableOpacity>
          <View style={[styles.divider, isDark && styles.dividerDark]} />
          <TouchableOpacity
            style={styles.actionRow}
            onPress={exportAll}
            disabled={bulkExporting}
            activeOpacity={0.2}
          >
            <MaterialCommunityIcons name="zip-box-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionText, isDark && styles.textLight]}>
                {bulkExporting
                  ? bulkPhase === 'compressing'
                    ? t('export.bulkCompressing')
                    : bulkPhase === 'sharing'
                      ? t('export.bulkSharing')
                      : t('export.bulkExporting', { current: bulkCurrent, total: bulkTotal })
                  : t('export.bulkExport', { count: cacheStats.totalActivities })}
              </Text>
              {bulkExporting && (
                <>
                  <View
                    style={[styles.progressBarContainer, isDark && styles.progressBarContainerDark]}
                  >
                    <View
                      style={[
                        styles.progressBar,
                        {
                          width:
                            bulkTotal > 0
                              ? `${Math.round((bulkCurrent / bulkTotal) * 100)}%`
                              : '0%',
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.progressDetail, isDark && styles.textMuted]}>
                    {bulkTotal > 0 ? `${Math.round((bulkCurrent / bulkTotal) * 100)}%` : '0%'}
                    {bulkSizeBytes > 0 && ` · ${formatBytes(bulkSizeBytes)}`}
                  </Text>
                </>
              )}
            </View>
            {!bulkExporting && (
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={isDark ? darkColors.textMuted : colors.textSecondary}
              />
            )}
          </TouchableOpacity>
          <View style={[styles.divider, isDark && styles.dividerDark]} />

          {/* Cache Stats - inline */}
          <View style={styles.statRow}>
            <TouchableOpacity
              style={styles.statItem}
              onPress={() => router.push('/map' as Href)}
              activeOpacity={0.7}
            >
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {cacheStats.totalActivities}
              </Text>
              <Text style={[styles.statLabel, styles.statLabelClickable]}>
                {t('settings.activities')} ›
              </Text>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity
              style={styles.statItem}
              onPress={() => router.push('/routes' as Href)}
              disabled={!routeSettings.enabled}
              activeOpacity={0.7}
            >
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {routeSettings.enabled ? routeGroups.length : '-'}
              </Text>
              <Text
                style={[
                  styles.statLabel,
                  routeSettings.enabled ? styles.statLabelClickable : isDark && styles.textMuted,
                ]}
              >
                {t('settings.routesCount')} ›
              </Text>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity
              style={styles.statItem}
              onPress={() => router.push('/routes?tab=sections' as Href)}
              disabled={!routeSettings.enabled}
              activeOpacity={0.7}
            >
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {routeSettings.enabled ? totalSections : '-'}
              </Text>
              <Text
                style={[
                  styles.statLabel,
                  routeSettings.enabled ? styles.statLabelClickable : isDark && styles.textMuted,
                ]}
              >
                {t('settings.sectionsCount')} ›
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
              {t('settings.dateRange')}
            </Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>{dateRangeText}</Text>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
              {t('settings.lastSynced')}
            </Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {formatDateOrDash(cacheStats.lastSync)}
            </Text>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
              {t('settings.cachedQueries')}
            </Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {queryCacheStats.totalQueries}
            </Text>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
              {t('settings.database')}
            </Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {formatBytes(cacheSizes.routes)}
            </Text>
          </View>

          <View style={[styles.divider, isDark && styles.dividerDark]} />

          {/* Route Matching Toggle - moved here from separate section */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={[styles.toggleLabel, isDark && styles.textLight]}>
                {t('settings.enableRouteMatching')}
              </Text>
              <Text style={[styles.toggleDescription, isDark && styles.textMuted]}>
                {t('settings.routeMatchingDescription')}
              </Text>
            </View>
            <Switch
              value={routeSettings.enabled}
              onValueChange={setRouteMatchingEnabled}
              color={colors.primary}
            />
          </View>

          <Text style={[styles.infoTextInline, isDark && styles.textMuted]}>
            {t('settings.cacheHint')}
          </Text>
        </View>

        <AccountSection />

        <DataSourcesSection />

        <SupportSection />
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  content: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.md,
  },
  backButton: {
    padding: spacing.xs,
    marginLeft: -spacing.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 32,
  },
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
  statRow: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  statLabelClickable: {
    fontSize: 12,
    color: colors.primary,
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoRowDark: {
    borderTopColor: darkColors.border,
  },
  infoLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
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
  progressBarContainer: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressBarContainerDark: {
    backgroundColor: darkColors.border,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressDetail: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 22 + spacing.sm, // icon + gap
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
  infoTextInline: {
    fontSize: 13,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    lineHeight: 18,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  toggleInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toggleDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
