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
import * as WebBrowser from 'expo-web-browser';
import { ScreenSafeAreaView } from '@/components/ui';
import { router, Href, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SegmentedButtons, Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useAthlete,
  useActivityBoundsCache,
  useRouteProcessing,
  useRouteGroups,
  useActivities,
  useOldestActivityDate,
  useTheme,
  useUnifiedSections,
} from '@/hooks';
import { TimelineSlider } from '@/components/maps';
import { formatLocalDate } from '@/lib';
import { estimateRoutesDatabaseSize, clearAllAppCaches } from '@/lib';
import {
  getThemePreference,
  setThemePreference,
  useMapPreferences,
  useAuthStore,
  useSportPreference,
  useRouteSettings,
  useLanguageStore,
  useSyncDateRange,
  type ThemePreference,
  type PrimarySport,
} from '@/providers';
import Constants from 'expo-constants';
import { type SupportedLocale } from '@/i18n';
import { type MapStyleType } from '@/components/maps';
import { colors, darkColors, spacing, layout } from '@/theme';
import { ProfileSection, DisplaySettings } from '@/components/settings';
import type { ActivityType } from '@/types';

// Activity type groups for map settings
// Each group applies the same map style to all its activity types
// Covers ALL ActivityType values from types/activity.ts
type FilterLabelKey =
  | 'filters.cycling'
  | 'filters.running'
  | 'filters.hiking'
  | 'filters.walking'
  | 'filters.swimming'
  | 'filters.snowSports'
  | 'filters.waterSports'
  | 'filters.climbing'
  | 'filters.racketSports'
  | 'filters.other';
const MAP_ACTIVITY_GROUPS: {
  key: string;
  labelKey: FilterLabelKey;
  types: ActivityType[];
}[] = [
  {
    key: 'cycling',
    labelKey: 'filters.cycling',
    types: ['Ride', 'VirtualRide'],
  },
  {
    key: 'running',
    labelKey: 'filters.running',
    types: ['Run', 'TrailRun', 'VirtualRun'],
  },
  { key: 'hiking', labelKey: 'filters.hiking', types: ['Hike', 'Snowshoe'] },
  { key: 'walking', labelKey: 'filters.walking', types: ['Walk'] },
  {
    key: 'swimming',
    labelKey: 'filters.swimming',
    types: ['Swim', 'OpenWaterSwim'],
  },
  {
    key: 'snow',
    labelKey: 'filters.snowSports',
    types: ['AlpineSki', 'NordicSki', 'BackcountrySki', 'Snowboard'],
  },
  {
    key: 'water',
    labelKey: 'filters.waterSports',
    types: ['Rowing', 'Kayaking', 'Canoeing'],
  },
  { key: 'climbing', labelKey: 'filters.climbing', types: ['RockClimbing'] },
  { key: 'racket', labelKey: 'filters.racketSports', types: ['Tennis'] },
  {
    key: 'other',
    labelKey: 'filters.other',
    types: ['Workout', 'WeightTraining', 'Yoga', 'Other'],
  },
];

function formatDate(dateStr: string | null, locale?: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  // Convert i18n locale (e.g., 'en-US') to BCP 47 tag for toLocaleDateString
  const bcp47Locale = locale?.replace('_', '-') || 'en-US';
  return date.toLocaleDateString(bcp47Locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { isDark } = useTheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [showLanguages, setShowLanguages] = useState(false);
  const [showActivityStyles, setShowActivityStyles] = useState(false);

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
  const {
    preferences: mapPreferences,
    setDefaultStyle,
    setActivityGroupStyle,
  } = useMapPreferences();
  const clearCredentials = useAuthStore((state) => state.clearCredentials);
  const isDemoMode = useAuthStore((state) => state.isDemoMode);
  const hideDemoBanner = useAuthStore((state) => state.hideDemoBanner);
  const setHideDemoBanner = useAuthStore((state) => state.setHideDemoBanner);
  const { primarySport, setPrimarySport } = useSportPreference();
  const { language, setLanguage } = useLanguageStore();

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

  const handleDefaultMapStyleChange = async (value: string) => {
    const style = value as MapStyleType;
    await setDefaultStyle(style);
  };

  const handleActivityGroupMapStyleChange = async (groupKey: string, value: string) => {
    const group = MAP_ACTIVITY_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;

    const style = value === 'default' ? null : (value as MapStyleType);
    await setActivityGroupStyle(group.types, style);
  };

  // Fetch activities to get date range for cache stats
  const { data: allActivities } = useActivities({
    days: 365 * 10,
    includeStats: false,
  });

  const { progress, cacheStats, clearCache, sync, syncDateRange } = useActivityBoundsCache({
    activitiesWithDates: allActivities,
  });

  // Fetch oldest activity date from API for timeline extent
  const { data: apiOldestDate } = useOldestActivityDate();

  // Get sync state from global store
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
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

    // Fallback: use cached activities or 90 days ago
    if (!allActivities || allActivities.length === 0) {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      return { minDateForSlider: d, maxDateForSlider: now };
    }

    const dates = allActivities.map((a) => new Date(a.start_date_local).getTime());
    const oldestActivityTime = Math.min(...dates);

    return {
      minDateForSlider: new Date(oldestActivityTime),
      maxDateForSlider: now,
    };
  }, [apiOldestDate, allActivities]);

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
  }, [queryClient, cacheStats.totalActivities]); // Re-compute when activities change

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
            // 1. FIRST: Reset sync date range to 90 days (locks expansion)
            resetSyncDateRange();

            // 2. Clear GPS/bounds cache and route cache
            // Note: clearCache() already calls engine.clear(), so don't call clearRouteCache()
            // as that would emit a second 'syncReset' event and trigger duplicate syncs
            await clearCache();

            // 3. REMOVE queries entirely (not just clear) - prevents old date ranges persisting
            queryClient.removeQueries({ queryKey: ['activities'] });
            queryClient.removeQueries({ queryKey: ['wellness'] });
            queryClient.removeQueries({ queryKey: ['powerCurve'] });
            queryClient.removeQueries({ queryKey: ['paceCurve'] });
            queryClient.removeQueries({ queryKey: ['athlete'] });
            await AsyncStorage.removeItem('veloq-query-cache');

            // 4. Refetch with new 90-day range
            // Note: GlobalDataSync automatically triggers GPS sync when activities are refetched
            queryClient.refetchQueries({ queryKey: ['activities'] });
            queryClient.refetchQueries({ queryKey: ['wellness'] });
            queryClient.refetchQueries({ queryKey: ['powerCurve'] });
            queryClient.refetchQueries({ queryKey: ['paceCurve'] });
            queryClient.refetchQueries({ queryKey: ['athlete'] });

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

  const handleLogout = () => {
    Alert.alert(t('alerts.disconnectTitle'), t('alerts.disconnectMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('alerts.disconnect'),
        style: 'destructive',
        onPress: async () => {
          try {
            // Clear ALL cached data before logging out
            await clearAllAppCaches(queryClient);
            // Reset sync date range to default 90 days
            resetSyncDateRange();
            // Clear auth credentials
            await clearCredentials();
            router.replace('/login' as Href);
          } catch {
            Alert.alert(t('alerts.error'), t('alerts.failedToDisconnect'));
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
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.content}>
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

        {/* Display Settings: Appearance, Language, Primary Sport */}
        <DisplaySettings
          themePreference={themePreference}
          onThemeChange={handleThemeChange}
          primarySport={primarySport}
          onSportChange={handleSportChange}
          language={language ?? 'en-GB'}
          onLanguageChange={handleLanguageChange}
          showLanguages={showLanguages}
          setShowLanguages={setShowLanguages}
        />

        {/* Maps Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('settings.maps').toUpperCase()}
        </Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.mapStyleRow}>
            <Text style={[styles.mapStyleLabel, isDark && styles.textLight]}>
              {t('settings.defaultStyle')}
            </Text>
          </View>
          <View style={styles.themePickerContainer}>
            <SegmentedButtons
              value={mapPreferences.defaultStyle}
              onValueChange={handleDefaultMapStyleChange}
              buttons={[
                {
                  value: 'light',
                  label: t('settings.light'),
                  icon: 'map',
                },
                {
                  value: 'dark',
                  label: t('settings.dark'),
                  icon: 'map',
                },
                {
                  value: 'satellite',
                  label: t('settings.satellite'),
                  icon: 'satellite-variant',
                },
              ]}
              style={styles.themePicker}
            />
          </View>

          {/* Per-activity-type styles toggle */}
          <TouchableOpacity
            style={[styles.actionRow, styles.actionRowBorder]}
            onPress={() => setShowActivityStyles(!showActivityStyles)}
          >
            <MaterialCommunityIcons name="tune-variant" size={22} color={colors.primary} />
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {t('settings.customiseByActivity')}
            </Text>
            <MaterialCommunityIcons
              name={showActivityStyles ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
          </TouchableOpacity>

          {/* Per-activity-group pickers */}
          {showActivityStyles && (
            <View style={styles.activityStylesContainer}>
              {MAP_ACTIVITY_GROUPS.map(({ key, labelKey, types }) => {
                // Use the first type in the group to determine current style
                const currentStyle = mapPreferences.activityTypeStyles[types[0]] ?? 'default';
                return (
                  <View key={key} style={styles.activityStyleRow}>
                    <Text style={[styles.activityStyleLabel, isDark && styles.textLight]}>
                      {t(labelKey)}
                    </Text>
                    <SegmentedButtons
                      value={currentStyle}
                      onValueChange={(value) => handleActivityGroupMapStyleChange(key, value)}
                      buttons={[
                        { value: 'default', label: t('settings.default') },
                        { value: 'light', label: t('settings.light') },
                        { value: 'dark', label: t('settings.dark') },
                        { value: 'satellite', label: t('settings.satellite') },
                      ]}
                      density="small"
                      style={styles.activityStylePicker}
                    />
                  </View>
                );
              })}
              <Text style={[styles.activityStyleHint, isDark && styles.textMuted]}>
                {t('settings.defaultMapHint')}
              </Text>
            </View>
          )}
        </View>

        {/* Data Cache Section - Consolidated */}
        <View onLayout={handleDataCacheSectionLayout}>
          <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
            {t('settings.dataCache').toUpperCase()}
          </Text>
        </View>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          {/* Sync Status Banners */}
          {progress.status === 'syncing' && (
            <View style={styles.syncBanner}>
              <MaterialCommunityIcons name="sync" size={18} color={colors.textOnDark} />
              <Text style={styles.syncBannerText}>
                {progress.message || `Syncing ${progress.completed}/${progress.total}`}
              </Text>
            </View>
          )}
          {isRouteProcessing && (
            <View style={[styles.syncBanner, { backgroundColor: colors.chartPurple }]}>
              <MaterialCommunityIcons name="map-marker-path" size={18} color={colors.textOnDark} />
              <Text style={styles.syncBannerText}>
                {routeProgress.message ||
                  `Analysing ${routeProgress.current}/${routeProgress.total}`}
              </Text>
            </View>
          )}

          {/* Timeline Slider for date range selection - simplified for settings */}
          {/* fixedEnd: right handle locked at "now", expandOnly: left handle can only move left */}
          <TimelineSlider
            minDate={minDateForSlider}
            maxDate={maxDateForSlider}
            startDate={cachedStartDate}
            endDate={cachedEndDate}
            onRangeChange={handleRangeChange}
            isLoading={isSyncing}
            activityCount={cacheStats.totalActivities}
            syncProgress={null}
            cachedOldest={null}
            cachedNewest={null}
            isDark={isDark}
            showActivityFilter={false}
            showCachedRange={false}
            showLegend={false}
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
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {cacheStats.oldestDate && cacheStats.newestDate
                ? (() => {
                    const oldest = new Date(cacheStats.oldestDate);
                    const newest = new Date(cacheStats.newestDate);
                    const days = Math.ceil(
                      (newest.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24)
                    );
                    return `${formatDate(cacheStats.oldestDate, i18n.language)} - ${formatDate(cacheStats.newestDate, i18n.language)} (${t('stats.daysCount', { count: days })})`;
                  })()
                : t('settings.noData')}
            </Text>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
              {t('settings.lastSynced')}
            </Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {formatDate(cacheStats.lastSync, i18n.language)}
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

          <Text style={[styles.infoTextInline, isDark && styles.textMuted]}>
            {t('settings.cacheHint')}
          </Text>
        </View>

        {/* Route Matching Toggle */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('settings.routeMatching').toUpperCase()}
        </Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
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
        </View>

        {/* Account Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('settings.account').toUpperCase()}
        </Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/about' as Href)}>
            <MaterialCommunityIcons name="information-outline" size={22} color={colors.primary} />
            <Text style={[styles.actionText, isDark && styles.textLight]}>{t('about.title')}</Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
          </TouchableOpacity>

          <View style={[styles.divider, isDark && styles.dividerDark]} />

          <TouchableOpacity
            testID="settings-logout-button"
            style={styles.actionRow}
            onPress={handleLogout}
          >
            <MaterialCommunityIcons name="logout" size={22} color={colors.error} />
            <Text style={[styles.actionText, styles.actionTextDanger]}>
              {t('settings.disconnectAccount')}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Data Sources Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('settings.dataSources').toUpperCase()}
        </Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.dataSourcesContent}>
            <Text style={[styles.dataSourcesText, isDark && styles.textMuted]}>
              {t('settings.dataSourcesDescription')}
            </Text>
            <View style={styles.dataSourcesLogos}>
              <View style={styles.dataSourceItem}>
                <MaterialCommunityIcons
                  name="watch"
                  size={20}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.dataSourceName, isDark && styles.textLight]}>Garmin</Text>
              </View>
              <View style={styles.dataSourceItem}>
                <MaterialCommunityIcons
                  name="run"
                  size={20}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.dataSourceName, isDark && styles.textLight]}>Strava</Text>
              </View>
              <View style={styles.dataSourceItem}>
                <MaterialCommunityIcons
                  name="watch"
                  size={20}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.dataSourceName, isDark && styles.textLight]}>Polar</Text>
              </View>
              <View style={styles.dataSourceItem}>
                <MaterialCommunityIcons
                  name="watch"
                  size={20}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.dataSourceName, isDark && styles.textLight]}>Wahoo</Text>
              </View>
            </View>
            <Text style={[styles.trademarkText, isDark && styles.textMuted]}>
              {t('attribution.garminTrademark')}
            </Text>
          </View>
        </View>

        {/* Demo Data Sources Section - Only visible in demo mode */}
        {isDemoMode && (
          <>
            <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
              {t('settings.demoDataSources').toUpperCase()}
            </Text>
            <View style={[styles.section, isDark && styles.sectionDark]}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={[styles.toggleLabel, isDark && styles.textLight]}>
                    {t('settings.hideDemoBanner')}
                  </Text>
                  <Text style={[styles.toggleDescription, isDark && styles.textMuted]}>
                    {t('settings.hideDemoBannerHint')}
                  </Text>
                </View>
                <Switch
                  value={hideDemoBanner}
                  onValueChange={setHideDemoBanner}
                  color={colors.primary}
                />
              </View>
              <View style={[styles.divider, isDark && styles.dividerDark]} />
              <View style={styles.dataSourcesContent}>
                <Text style={[styles.dataSourcesText, isDark && styles.textMuted]}>
                  {t('attribution.demoData')}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Support Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
          {t('settings.support').toUpperCase()}
        </Text>
        <View style={styles.supportRow}>
          <TouchableOpacity
            style={[styles.supportCard, isDark && styles.supportCardDark]}
            onPress={() =>
              WebBrowser.openBrowserAsync('https://intervals.icu/settings/subscription')
            }
            activeOpacity={0.7}
          >
            <View style={[styles.supportIconBg, { backgroundColor: 'rgba(233, 30, 99, 0.12)' }]}>
              <MaterialCommunityIcons name="heart" size={24} color={colors.chartPink} />
            </View>
            <Text style={[styles.supportTitle, isDark && styles.textLight]}>intervals.icu</Text>
            <Text style={[styles.supportSubtitle, isDark && styles.textMuted]}>
              {t('settings.subscribe')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.supportCard, isDark && styles.supportCardDark]}
            onPress={() => WebBrowser.openBrowserAsync('https://github.com/sponsors/evanjt')}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.supportIconBg,
                {
                  backgroundColor: isDark ? darkColors.surfaceElevated : colors.divider,
                },
              ]}
            >
              <MaterialCommunityIcons
                name="github"
                size={24}
                color={isDark ? colors.textOnDark : colors.textPrimary}
              />
            </View>
            <Text style={[styles.supportTitle, isDark && styles.textLight]}>@evanjt</Text>
            <Text style={[styles.supportSubtitle, isDark && styles.textMuted]}>
              {t('settings.sponsorDev')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Version */}
        <Text
          testID="settings-version-text"
          style={[styles.versionText, isDark && styles.textMuted]}
        >
          {t('settings.version')} {Constants.expoConfig?.version ?? '0.0.1'}
        </Text>
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
    paddingBottom: spacing.xl,
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
  sectionSpaced: {
    marginTop: spacing.md,
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  syncBannerText: {
    color: colors.textOnDark,
    fontSize: 14,
    fontWeight: '500',
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
  supportRow: {
    flexDirection: 'row',
    marginHorizontal: layout.screenPadding,
    gap: spacing.sm,
  },
  supportCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  supportCardDark: {
    backgroundColor: darkColors.surfaceCard,
    shadowOpacity: 0,
  },
  supportIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  supportTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  supportSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
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
  themePickerContainer: {
    padding: spacing.md,
  },
  themePicker: {
    // React Native Paper SegmentedButtons handles styling
  },
  mapStyleRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  mapStyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  actionRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  activityStylesContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  activityStyleRow: {
    marginTop: spacing.md,
  },
  activityStyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  activityStylePicker: {
    // Handled by React Native Paper
  },
  activityStyleHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  dataSourcesContent: {
    padding: spacing.md,
  },
  dataSourcesText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  dataSourcesLogos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  dataSourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dataSourceName: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  trademarkText: {
    fontSize: 10,
    color: colors.textSecondary,
    opacity: 0.7,
    lineHeight: 14,
  },
  versionText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
});
