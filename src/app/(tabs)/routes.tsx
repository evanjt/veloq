import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { ScreenSafeAreaView, ScreenErrorBoundary } from '@/components/ui';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { RoutesList, SectionsList, DateRangeSummary, SyncDebugTab } from '@/components';
import { InsightsPanel } from '@/components/insights';
import { StrengthTab } from '@/components/insights/StrengthTab';
import { SwipeableTabs, type SwipeableTab } from '@/components/ui';
import {
  useRouteProcessing,
  useActivityBoundsCache,
  useOldestActivityDate,
  useTheme,
  useRoutesScreenData,
  useCustomSections,
  useInsights,
  useUserLocation,
} from '@/hooks';
import { useHasStrengthData } from '@/hooks/activities/useStrengthVolume';
import { useRouteNameGeocoding } from '@/hooks/routes/useRouteNameGeocoding';
import { useRouteSettings, useSyncDateRange, useDebugStore, useEngineStatus } from '@/providers';
import { colors, darkColors, spacing } from '@/theme';
import type { ActivityType } from '@/types';

type TabType = 'insights' | 'strength' | 'routes' | 'sections' | 'debug';

export default function RoutesScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('RoutesScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const { insights, markAsSeen } = useInsights();
  const { location: userLocation } = useUserLocation();

  // Check if route matching is enabled
  const routeSettings = useRouteSettings((s) => s.settings);
  const isRouteMatchingEnabled = routeSettings.enabled;

  // Background geocoding for generic "Route N" / "Section N" names
  useRouteNameGeocoding(isRouteMatchingEnabled);

  // Strength data availability
  const hasStrength = useHasStrengthData();

  // Debug mode
  const debugEnabled = useDebugStore((s) => s.enabled);

  // Engine init failure banner
  const engineInitFailed = useEngineStatus((s) => s.initFailed);
  const [engineBannerDismissed, setEngineBannerDismissed] = useState(false);

  const { clearCache: clearRouteCache } = useRouteProcessing();

  // Single FFI call for all routes screen data (groups, sections, counts)
  const {
    data: routesData,
    loadMoreGroups,
    loadMoreSections,
    hasMoreGroups,
    hasMoreSections,
  } = useRoutesScreenData({ groupLimit: 50, sectionLimit: 100 });

  // Derive counts from batch data
  const routeGroupCount = routesData?.groupCount ?? 0;
  const groupsDirty = routesData?.groupsDirty ?? false;

  // Include custom sections in total count — Rust sectionCount may not include
  // custom sections added via backup restore if the engine data hasn't refreshed yet
  const { count: customSectionCount } = useCustomSections();
  const rustSectionCount = routesData?.sectionCount ?? 0;
  const batchCustomCount =
    routesData?.sections?.filter((s) => s.id.startsWith('custom_')).length ?? 0;
  const totalSections = rustSectionCount + Math.max(0, customSectionCount - batchCustomCount);

  // Fetch the true oldest activity date from API (for timeline extent)
  const { data: apiOldestDate } = useOldestActivityDate();

  // Get sync date range from store
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);

  // Get sync state from engine cache
  const {
    isReady: boundsReady,
    progress: syncProgress,
    syncDateRange,
    sync: triggerSync,
  } = useActivityBoundsCache();

  // Tab state - initialize from URL param if provided, default to insights
  const [activeTab, setActiveTab] = useState<TabType>(() =>
    tab === 'sections' ? 'sections' : tab === 'routes' ? 'routes' : 'insights'
  );

  // Mark insights as seen when insights tab is active and screen is focused
  useFocusEffect(
    useCallback(() => {
      if (activeTab === 'insights') {
        markAsSeen();
      }
    }, [markAsSeen, activeTab])
  );

  // Update tab when URL param changes (e.g., navigating from settings with ?tab=sections)
  useEffect(() => {
    if (tab === 'sections' || tab === 'routes' || tab === 'insights') {
      setActiveTab(tab);
    }
  }, [tab]);

  // Reset to routes if debug tab is active but debug mode was turned off
  useEffect(() => {
    if (!debugEnabled && activeTab === 'debug') {
      setActiveTab('routes');
    }
  }, [debugEnabled, activeTab]);

  // Tabs configuration for SwipeableTabs
  const tabs = useMemo<SwipeableTab[]>(() => {
    const result: SwipeableTab[] = [
      {
        key: 'insights',
        label: t('insights.title', 'Insights'),
        icon: 'lightbulb-outline',
      },
    ];
    if (hasStrength) {
      result.push({
        key: 'strength',
        label: t('insights.strength', 'Strength'),
        icon: 'dumbbell',
      });
    }
    result.push(
      {
        key: 'routes',
        label: t('trainingScreen.routes'),
        icon: 'map-marker-path',
        count: routeGroupCount,
      },
      {
        key: 'sections',
        label: t('trainingScreen.sections'),
        icon: 'road-variant',
        count: totalSections,
      }
    );
    if (debugEnabled) {
      result.push({ key: 'debug', label: 'Sync', icon: 'bug-outline' });
    }
    return result;
  }, [t, routeGroupCount, totalSections, debugEnabled, hasStrength]);

  // Date range state - default to full cached range (show all data)
  const now = useMemo(() => new Date(), []);

  // Track if we've initialized from cache
  const [hasInitialized, setHasInitialized] = useState(false);

  const [startDate, setStartDate] = useState<Date>(() => new Date(syncOldest));
  const [endDate, setEndDate] = useState<Date>(() => new Date(syncNewest));

  // Initialize slider to cached range once GPS-synced activities are loaded from engine
  // NOTE: We only update the slider state here, NOT the sync range.
  // Expansion should only happen from explicit user action (timeline drag).
  useEffect(() => {
    if (!hasInitialized && boundsReady) {
      // Use sync date range from store (represents what we've synced)
      setStartDate(new Date(syncOldest));
      setEndDate(new Date(syncNewest));
      setHasInitialized(true);
    }
  }, [hasInitialized, boundsReady, syncOldest, syncNewest]);

  // Min/max dates for timeline - use API oldest date for full extent
  const minDate = useMemo(() => {
    return apiOldestDate ? new Date(apiOldestDate) : new Date(now.getFullYear() - 5, 0, 1);
  }, [apiOldestDate, now]);

  // Max date is always "now" (today)
  const maxDate = now;

  // Handle timeline range changes
  const handleRangeChange = useCallback(
    (start: Date, end: Date) => {
      setStartDate(start);
      setEndDate(end);

      // Expand the global sync date range to trigger GPS data fetching
      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];
      syncDateRange(startStr, endStr);
    },
    [syncDateRange]
  );

  // Read GPS sync progress from shared store (GlobalDataSync is the single sync coordinator)
  // No need to call useActivities here - GlobalDataSync handles activity fetching
  const dataSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isDataSyncing = useSyncDateRange((s) => s.isGpsSyncing);

  // Sync status for UI - include when fetching extended date range
  const isSyncing = syncProgress.status === 'syncing' || isDataSyncing || isFetchingExtended;

  // Track refetch state for pull-to-refresh
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await triggerSync();
    } finally {
      setIsRefreshing(false);
    }
  }, [triggerSync]);

  // Calculate cached range from sync store and batch data activity count
  const { oldestSyncedDate, newestSyncedDate, activityCount } = useMemo(() => {
    const count = routesData?.activityCount ?? 0;

    if (count === 0) {
      return {
        oldestSyncedDate: null,
        newestSyncedDate: null,
        activityCount: 0,
      };
    }

    return {
      oldestSyncedDate: syncOldest,
      newestSyncedDate: syncNewest,
      activityCount: count,
    };
  }, [routesData?.activityCount, syncOldest, syncNewest]);

  // Convert sync/processing progress to unified phased format
  // Phases: 1) Loading activities, 2) Downloading GPS, 3) Analyzing routes
  const timelineSyncProgress = useMemo(() => {
    // Phase 1: Loading activities from API / extending date range
    // Only show when we don't have data yet (avoid showing during background refetches)
    if (isFetchingExtended && !routesData?.activityCount) {
      return {
        message: t('mapScreen.loadingActivities') as string,
        phase: 1,
      };
    }

    // Phase 2: Downloading GPS data (from bounds sync)
    if (syncProgress.status === 'syncing') {
      const countText =
        syncProgress.total > 0 ? ` (${syncProgress.completed}/${syncProgress.total})` : '';
      return {
        message: `${t('routesScreen.downloadingGps')}${countText}` as string,
        phase: 2,
      };
    }

    // Phase 3: Analyzing routes (check BEFORE downloading status)
    if (dataSyncProgress.status === 'computing') {
      const pct = dataSyncProgress.percent;
      const text = t('cache.analyzingRoutes') as string;
      return {
        message: pct > 0 ? `${text}... ${pct}%` : `${text}...`,
        phase: 3,
      };
    }

    // Phase 2b: Fetching GPS (from route data sync)
    if (isDataSyncing && dataSyncProgress.status === 'fetching' && dataSyncProgress.total > 0) {
      return {
        message:
          `${t('routesScreen.downloadingGps')} (${dataSyncProgress.completed}/${dataSyncProgress.total})` as string,
        phase: 2,
      };
    }

    return null;
  }, [
    isFetchingExtended,
    syncProgress,
    isDataSyncing,
    dataSyncProgress,
    routesData?.activityCount,
    t,
  ]);

  // Show disabled state if route matching is not enabled
  if (!isRouteMatchingEnabled) {
    return (
      <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>
            {t('insights.title', 'Insights')}
          </Text>
        </View>

        <View style={styles.disabledContainer}>
          <MaterialCommunityIcons
            name="map-marker-off"
            size={64}
            color={isDark ? darkColors.textMuted : colors.border}
          />
          <Text style={[styles.disabledTitle, isDark && styles.textLight]}>
            {t('routesScreen.matchingDisabled')}
          </Text>
          <Text style={[styles.disabledText, isDark && styles.textMuted]}>
            {t('routesScreen.enableInSettings')}
          </Text>
          <IconButton
            icon="cog"
            iconColor={colors.primary}
            size={32}
            onPress={() => router.push('/settings')}
          />
          <Text style={[styles.disabledHint, isDark && styles.textMuted]}>
            {t('routesScreen.goToSettings')}
          </Text>
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenErrorBoundary screenName="Insights">
      <ScreenSafeAreaView
        style={[styles.container, isDark && styles.containerDark]}
        testID="routes-screen"
      >
        <View style={styles.header}>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>
            {t('insights.title', 'Insights')}
          </Text>
          <IconButton
            icon="information-outline"
            size={20}
            iconColor={isDark ? darkColors.textMuted : colors.textMuted}
            onPress={() =>
              Alert.alert(
                t('insights.aboutTitle', 'About Insights'),
                t(
                  'insights.aboutBody',
                  'Training metrics are estimates based on published exercise science models. Individual responses vary significantly. These insights are informational only \u2014 not medical or coaching advice.'
                )
              )
            }
            style={styles.infoButton}
          />
        </View>

        {/* Date range summary - shows cached range with link to expand */}
        <DateRangeSummary
          activityCount={activityCount}
          oldestDate={oldestSyncedDate}
          newestDate={newestSyncedDate}
          isDark={isDark}
          isLoading={!routesData}
          syncMessage={
            timelineSyncProgress?.message ||
            (groupsDirty ? t('routesScreen.computingRoutes') : null)
          }
        />

        {/* Engine init failure warning */}
        {engineInitFailed && !engineBannerDismissed && (
          <View style={[styles.engineBanner, isDark && styles.engineBannerDark]}>
            <MaterialCommunityIcons
              name="alert-outline"
              size={16}
              color={isDark ? '#FBBF24' : '#92400E'}
            />
            <Text
              style={[styles.engineBannerText, isDark && styles.engineBannerTextDark]}
              numberOfLines={2}
            >
              {t('engine.initFailed')}
            </Text>
            <IconButton
              icon="close"
              size={16}
              iconColor={isDark ? '#FBBF24' : '#92400E'}
              onPress={() => setEngineBannerDismissed(true)}
              style={styles.engineBannerClose}
            />
          </View>
        )}

        {/* Swipeable Insights/Routes/Sections tabs */}
        <SwipeableTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(key) => setActiveTab(key as TabType)}
          isDark={isDark}
          lazy
        >
          <InsightsPanel insights={insights} />
          {hasStrength ? <StrengthTab /> : null}
          <RoutesList
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
            batchGroups={routesData?.groups ?? []}
            onLoadMore={loadMoreGroups}
            hasMore={hasMoreGroups}
            userLocation={userLocation}
          />
          <SectionsList
            batchSections={routesData?.sections}
            onLoadMore={loadMoreSections}
            hasMore={hasMoreSections}
            totalSectionCount={totalSections}
            userLocation={userLocation}
          />
          {debugEnabled ? <SyncDebugTab /> : null}
        </SwipeableTabs>
      </ScreenSafeAreaView>
    </ScreenErrorBoundary>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  infoButton: {
    margin: 0,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  disabledContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  disabledTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  disabledText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  disabledHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: -spacing.sm,
  },
  engineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    gap: spacing.sm,
  },
  engineBannerDark: {
    backgroundColor: '#422006',
  },
  engineBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
  engineBannerTextDark: {
    color: '#FBBF24',
  },
  engineBannerClose: {
    margin: 0,
    padding: 0,
  },
});
