import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { RoutesList, SectionsList, DateRangeSummary } from '@/components';
import { SwipeableTabs, type SwipeableTab } from '@/components/ui';
import {
  useRouteProcessing,
  useActivityBoundsCache,
  useRouteGroups,
  useEngineStats,
  useOldestActivityDate,
  useTheme,
} from '@/hooks';
import { useUnifiedSections } from '@/hooks/routes/useUnifiedSections';
import { useRouteSettings, useSyncDateRange } from '@/providers';
import { colors, darkColors, spacing } from '@/theme';
import { createSharedStyles } from '@/styles';
import { debug } from '@/lib';
import type { ActivityType } from '@/types';

type TabType = 'routes' | 'sections';

const log = debug.create('Routes');

export default function RoutesScreen() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const { tab } = useLocalSearchParams<{ tab?: string }>();

  // Check if route matching is enabled
  const { settings: routeSettings } = useRouteSettings();
  const isRouteMatchingEnabled = routeSettings.enabled;

  const { clearCache: clearRouteCache } = useRouteProcessing();

  // Get engine stats
  const engineStats = useEngineStats();

  // Fetch the true oldest activity date from API (for timeline extent)
  const { data: apiOldestDate } = useOldestActivityDate();

  // Get sync date range from store
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);

  // Get cached bounds for timeline limits
  // Also get activities from engine to determine the full cached range
  const {
    activities: cachedActivities,
    isReady: boundsReady,
    progress: syncProgress,
    syncDateRange,
    sync: triggerSync,
  } = useActivityBoundsCache();

  // Get route groups to count (use minActivities: 2 to match the list)
  const { groups: routeGroups } = useRouteGroups({ minActivities: 2 });

  // Get unified sections count (auto-detected + custom)
  const { count: totalSections } = useUnifiedSections();

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
        count: routeGroups.length,
      },
      {
        key: 'sections',
        label: t('trainingScreen.sections'),
        icon: 'road-variant',
        count: totalSections,
      },
    ],
    [t, routeGroups.length, totalSections]
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
    if (!hasInitialized && cachedActivities && cachedActivities.length > 0) {
      // Find the oldest and newest activity dates from the engine cache
      let oldest: Date | null = null;
      let newest: Date | null = null;
      for (const a of cachedActivities) {
        const date = a.date ? new Date(a.date) : null;
        if (date) {
          if (!oldest || date < oldest) oldest = date;
          if (!newest || date > newest) newest = date;
        }
      }
      if (oldest && newest) {
        setStartDate(oldest);
        setEndDate(newest);
        // Do NOT call syncDateRange here - expansion should only happen from user action
        setHasInitialized(true);
      }
    }
  }, [hasInitialized, cachedActivities]);

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

  // Calculate cached range from engine activities (shows the full synced range)
  const { oldestSyncedDate, newestSyncedDate } = useMemo(() => {
    if (!cachedActivities || cachedActivities.length === 0) {
      return { oldestSyncedDate: null, newestSyncedDate: null };
    }
    let oldest: string | null = null;
    let newest: string | null = null;
    for (const a of cachedActivities) {
      const date = a.date;
      if (date) {
        if (!oldest || date < oldest) oldest = date;
        if (!newest || date > newest) newest = date;
      }
    }
    return { oldestSyncedDate: oldest, newestSyncedDate: newest };
  }, [cachedActivities]);

  // Convert sync/processing progress to unified phased format
  // Phases: 1) Loading activities, 2) Downloading GPS, 3) Analyzing routes
  const timelineSyncProgress = useMemo(() => {
    // Phase 1: Loading activities from API / extending date range
    if (isFetchingExtended) {
      return {
        completed: 0,
        total: 0,
        message: t('mapScreen.loadingActivities') as string,
        phase: 1,
      };
    }

    // Phase 2: Downloading GPS data (from bounds sync)
    if (syncProgress.status === 'syncing') {
      return {
        completed: syncProgress.completed,
        total: syncProgress.total,
        message: (syncProgress.total > 0
          ? `${t('routesScreen.downloadingGps')} (${syncProgress.completed}/${syncProgress.total})`
          : t('routesScreen.downloadingGps')) as string,
        phase: 2,
      };
    }

    // Phase 3: Analyzing routes (check BEFORE downloading status)
    if (dataSyncProgress.status === 'computing') {
      return {
        completed: 0,
        total: 0,
        message: dataSyncProgress.message || (t('routesScreen.computingRoutes') as string),
        phase: 3,
      };
    }

    // Phase 2b: Fetching GPS (from route data sync)
    if (isDataSyncing && dataSyncProgress.status === 'fetching' && dataSyncProgress.total > 0) {
      return {
        completed: dataSyncProgress.completed,
        total: dataSyncProgress.total,
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
          <IconButton
            icon="arrow-left"
            iconColor={isDark ? colors.textOnDark : colors.textPrimary}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>
            {t('routesScreen.title')}
          </Text>
          <View style={styles.headerRight} />
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
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? colors.textOnDark : colors.textPrimary}
          onPress={() => router.back()}
        />
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>
          {t('routesScreen.title')}
        </Text>
        <View style={styles.headerRight} />
      </View>

      {/* Date range summary - shows cached range with link to expand */}
      <DateRangeSummary
        activityCount={cachedActivities?.length || 0}
        oldestDate={oldestSyncedDate}
        newestDate={newestSyncedDate}
        isDark={isDark}
        isLoading={isSyncing}
        syncMessage={timelineSyncProgress?.message || null}
      />

      {/* Swipeable Routes/Sections tabs */}
      <SwipeableTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as TabType)}
        isDark={isDark}
      >
        <RoutesList onRefresh={handleRefresh} isRefreshing={isRefreshing} />
        <SectionsList />
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
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerRight: {
    width: 48,
    alignItems: 'flex-end',
    paddingRight: spacing.sm,
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
