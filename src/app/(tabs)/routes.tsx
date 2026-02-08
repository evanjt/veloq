import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { RoutesList, SectionsList, DateRangeSummary } from '@/components';
import { SwipeableTabs, type SwipeableTab } from '@/components/ui';
import {
  useRouteProcessing,
  useActivityBoundsCache,
  useOldestActivityDate,
  useTheme,
  useRoutesScreenData,
} from '@/hooks';
import { useRouteSettings, useSyncDateRange } from '@/providers';
import { colors, darkColors, spacing } from '@/theme';
import type { ActivityType } from '@/types';

type TabType = 'routes' | 'sections';

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

  // Check if route matching is enabled
  const routeSettings = useRouteSettings((s) => s.settings);
  const isRouteMatchingEnabled = routeSettings.enabled;

  const { clearCache: clearRouteCache } = useRouteProcessing();

  // Single FFI call for all routes screen data (groups, sections, counts)
  const {
    data: routesData,
    loadMoreGroups,
    loadMoreSections,
    hasMoreGroups,
    hasMoreSections,
  } = useRoutesScreenData({ groupLimit: 20, sectionLimit: 20 });

  // Derive counts from batch data
  const routeGroupCount = routesData?.groupCount ?? 0;
  const totalSections = routesData?.sectionCount ?? 0;

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

  // Tab state - initialize from URL param if provided
  const [activeTab, setActiveTab] = useState<TabType>(() =>
    tab === 'sections' ? 'sections' : 'routes'
  );

  // Update tab when URL param changes (e.g., navigating from settings with ?tab=sections)
  useEffect(() => {
    if (tab === 'sections' || tab === 'routes') {
      setActiveTab(tab);
    }
  }, [tab]);

  // Tabs configuration for SwipeableTabs
  const tabs = useMemo<[SwipeableTab, SwipeableTab]>(
    () => [
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
      },
    ],
    [t, routeGroupCount, totalSections]
  );

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
    if (isFetchingExtended) {
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
  }, [isFetchingExtended, syncProgress, isDataSyncing, dataSyncProgress, t]);

  // Show disabled state if route matching is not enabled
  if (!isRouteMatchingEnabled) {
    return (
      <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>
            {t('routesScreen.title')}
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
    <ScreenSafeAreaView
      style={[styles.container, isDark && styles.containerDark]}
      testID="routes-screen"
    >
      <View style={styles.header}>
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>
          {t('routesScreen.title')}
        </Text>
      </View>

      {/* Date range summary - shows cached range with link to expand */}
      <DateRangeSummary
        activityCount={activityCount}
        oldestDate={oldestSyncedDate}
        newestDate={newestSyncedDate}
        isDark={isDark}
        isLoading={!routesData}
        syncMessage={timelineSyncProgress?.message || null}
      />

      {/* Swipeable Routes/Sections tabs */}
      <SwipeableTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as TabType)}
        isDark={isDark}
        lazy
      >
        <RoutesList
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          batchGroups={routesData?.groups ?? []}
          onLoadMore={loadMoreGroups}
          hasMore={hasMoreGroups}
        />
        <SectionsList
          batchSections={routesData?.sections}
          onLoadMore={loadMoreSections}
          hasMore={hasMoreSections}
        />
      </SwipeableTabs>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
});
