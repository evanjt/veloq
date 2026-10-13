import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Stack, useFocusEffect, router, useLocalSearchParams } from 'expo-router';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  IconButton,
  ScreenSafeAreaView,
  SwipeableTabs,
  pressable,
  pressRipple,
  type SwipeableTab,
} from '@/shared/ui';
import { onPullRefresh } from '@/shared/ui/haptics';
import { aboutInsightsBody, InsightsPanel, StrengthTab, useInsights } from '@/features/insights';
import {
  DateRangeSummary,
  RoutesList,
  type RoutesSortOption,
  SectionsList,
  type SectionsSortOption,
  useRoutesScreenData,
  DEFAULT_SECTION_HIDE_FLAGS,
  groupSortFor,
  sectionCountsOf,
  sectionFiltersFor,
  sectionSortFor,
  type SectionHideFlags,
  useRouteSettings,
} from '@/features/routes';
import { useTheme } from '@/shared/app';
import { useUserLocation } from '@/shared/app/useUserLocation';
import { strengthPeriodOf, useStrengthTabState } from '@/features/strength';
import type { StrengthPeriod } from '@/types';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { isExtendedFetchRunning } from '@/shared/app/extendedFetch';
import { progressLine } from '@/features/maps';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { useSyncRefreshNotice } from '@/shared/native/useSyncRefreshNotice';
import {
  colors,
  colorWithOpacity,
  darkColors,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { inform } from '@/shared/ui/dialog';

type TabType = 'insights' | 'strength' | 'routes' | 'sections';

function RouteTabEngineState({
  isDark,
  showDateRangeSummary,
  activityCount,
  oldestSyncedDate,
  newestSyncedDate,
  routesDataReady,
  syncMessage,
}: {
  isDark: boolean;
  showDateRangeSummary: boolean;
  activityCount: number;
  oldestSyncedDate: string | null;
  newestSyncedDate: string | null;
  routesDataReady: boolean;
  syncMessage: string | null;
}) {
  return (
    <>
      {showDateRangeSummary ? (
        <DateRangeSummary
          activityCount={activityCount}
          oldestDate={oldestSyncedDate}
          newestDate={newestSyncedDate}
          isDark={isDark}
          isLoading={!routesDataReady}
          syncMessage={syncMessage}
        />
      ) : null}
    </>
  );
}

function strengthPeriodLinkOf(param: string | undefined): { period: StrengthPeriod } | undefined {
  const period = strengthPeriodOf(param);
  return period ? { period } : undefined;
}

function InsightsScreenContent() {
  useTabFirstFrame('/insights');
  const { requestRefresh } = useSyncRefreshNotice();
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('InsightsScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { tab, insightId, period } = useLocalSearchParams<{
    tab?: string;
    insightId?: string;
    period?: string;
  }>();
  const { insights, failed, retry, form, markAsSeen, hrvWithheldSince } = useInsights();
  const strengthTab = useStrengthTabState();
  const hasStrength = strengthTab !== 'hidden';
  const { location: userLocation, requestPermission } = useUserLocation();
  const routeSortTouchedRef = useRef(false);
  const sectionSortTouchedRef = useRef(false);
  const [routeSort, setRouteSort] = useState<RoutesSortOption>(
    userLocation ? 'nearby' : 'activities'
  );
  const [sectionSort, setSectionSort] = useState<SectionsSortOption>(
    userLocation ? 'nearby' : 'visits'
  );

  // The sort, the search and the hide flags are the engine's query, not the
  // list's own state: it orders, filters and counts the catalogue before it
  // pages it.
  const [routeSearch, setRouteSearch] = useState('');
  const [sectionSearch, setSectionSearch] = useState('');
  const [routeSport, setRouteSport] = useState<string | undefined>(undefined);
  const [sectionSport, setSectionSport] = useState<string | undefined>(undefined);
  const [sectionHidden, setSectionHidden] = useState<SectionHideFlags>(DEFAULT_SECTION_HIDE_FLAGS);
  const sectionFilters = useMemo(() => sectionFiltersFor(sectionHidden), [sectionHidden]);
  const clearRouteFilters = useCallback(() => {
    setRouteSearch('');
    setRouteSport(undefined);
  }, []);
  const clearSectionFilters = useCallback(() => {
    setSectionSearch('');
    setSectionSport(undefined);
    setSectionHidden(DEFAULT_SECTION_HIDE_FLAGS);
  }, []);

  const routeSettings = useRouteSettings((s) => s.settings);
  const isRouteMatchingEnabled = routeSettings.enabled;

  const {
    data: routesData,
    status: routesStatus,
    error: routesReadError,
    retry: retryRoutesRead,
    loadMoreGroups,
    loadMoreSections,
    hasMoreGroups,
    hasMoreSections,
  } = useRoutesScreenData({
    groupLimit: 50,
    sectionLimit: 100,
    groupSort: groupSortFor(routeSort),
    groupSearch: routeSearch,
    sectionSort: sectionSortFor(sectionSort),
    sectionSearch,
    sectionFilters,
    groupSportType: routeSport,
    sectionSportType: sectionSport,
    userLocation,
  });

  const routesLoadError = routesStatus === 'error' ? routesReadError : null;
  const routeGroupCount = routesData?.groupCount ?? 0;
  const groupsDirty = routesData?.groupsDirty ?? false;

  const {
    total: totalSections,
    shown: shownSections,
    custom: customSectionCount,
  } = sectionCountsOf(routesData);

  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const isFetchingExtended = useSyncDateRange((s) => isExtendedFetchRunning(s.extendedFetch));
  const dataSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isDataSyncing = useSyncDateRange((s) => s.isGpsSyncing);
  const isAnalysingInBackground = useSyncDateRange((s) => s.isAnalysingInBackground);

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

    if (isRouteMatchingEnabled) {
      result.push({
        key: 'routes',
        label: t('trainingScreen.routes'),
        icon: 'map-marker-path',
      });

      result.push({
        key: 'sections',
        label: t('trainingScreen.sections'),
        icon: 'road-variant',
      });
    }

    return result;
  }, [hasStrength, isRouteMatchingEnabled, t]);

  const availableTabKeys = useMemo(() => new Set(tabs.map((entry) => entry.key)), [tabs]);
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    // Deep-link from home insight chip - always lands on insights tab.
    if (insightId) return 'insights';
    if (tab === 'strength' && hasStrength) return 'strength';
    if (tab === 'routes' || tab === 'sections' || tab === 'insights') {
      return tab;
    }
    return 'insights';
  });

  // When the insightId param is present, ensure the insights tab is active.
  useEffect(() => {
    if (insightId) {
      setActiveTab('insights');
    }
  }, [insightId]);

  // Clear the insightId URL param after the panel reports it has opened the
  // matching insight, so back-nav doesn't reopen the sheet.
  const handleInsightOpened = useCallback(() => {
    router.setParams({ insightId: undefined });
  }, []);

  useFocusEffect(
    useCallback(() => {
      markAsSeen();
    }, [markAsSeen])
  );

  // The param is cleared once applied, so a later push of the same tab changes
  // it again and the effect runs after the athlete has swiped elsewhere.
  useEffect(() => {
    if (!tab) return;
    if (availableTabKeys.has(tab)) {
      setActiveTab(tab as TabType);
      router.setParams({ tab: undefined });
    }
  }, [availableTabKeys, tab]);

  // A link's period goes to the strength tab as a new object each time the
  // param arrives, so a second link naming the same period still applies. It is
  // taken during render so the tab's first read is the linked period, and an
  // unknown period leaves the tab's own choice alone.
  const [periodParam, setPeriodParam] = useState(period);
  const [strengthPeriodLink, setStrengthPeriodLink] = useState<
    { period: StrengthPeriod } | undefined
  >(() => strengthPeriodLinkOf(period));
  if (period !== periodParam) {
    setPeriodParam(period);
    const link = strengthPeriodLinkOf(period);
    if (link) setStrengthPeriodLink(link);
  }

  useEffect(() => {
    if (period !== undefined) router.setParams({ period: undefined });
  }, [period]);

  // A tab that is no longer offered falls back to insights, which is always
  // offered, so this converges on the render it runs in rather than committing
  // a frame with nothing selected.
  if (!availableTabKeys.has(activeTab)) {
    setActiveTab('insights');
  }

  useEffect(() => {
    if (userLocation && !routeSortTouchedRef.current) {
      setRouteSort('nearby');
    }
  }, [userLocation]);

  useEffect(() => {
    if (userLocation && !sectionSortTouchedRef.current) {
      setSectionSort('nearby');
    }
  }, [userLocation]);

  const handleRouteSortChange = useCallback(
    async (next: RoutesSortOption) => {
      routeSortTouchedRef.current = true;
      if (next === 'nearby' && !userLocation) {
        const loc = await requestPermission();
        if (!loc) return;
      }
      setRouteSort(next);
    },
    [requestPermission, userLocation]
  );

  const handleSectionSortChange = useCallback(
    async (next: SectionsSortOption) => {
      sectionSortTouchedRef.current = true;
      if (next === 'nearby' && !userLocation) {
        const loc = await requestPermission();
        if (!loc) return;
      }
      setSectionSort(next);
    },
    [requestPermission, userLocation]
  );

  const handleRefresh = useMemo(() => onPullRefresh(requestRefresh), [requestRefresh]);

  const { oldestSyncedDate, newestSyncedDate, activityCount } = useMemo(() => {
    const count = routesData?.activityCount ?? 0;
    if (count === 0) {
      return { oldestSyncedDate: null, newestSyncedDate: null, activityCount: 0 };
    }
    return {
      oldestSyncedDate: syncOldest,
      newestSyncedDate: syncNewest,
      activityCount: count,
    };
  }, [routesData?.activityCount, syncOldest, syncNewest]);

  const timelineSyncProgress = useMemo(() => {
    // Phase 1: Fetching activity list from API (before GPS sync starts)
    if (isFetchingExtended && !isDataSyncing) {
      return { message: t('mapScreen.loadingActivities') as string, phase: 1 };
    }
    // Phase 2: Downloading GPS data
    if (dataSyncProgress.status === 'fetching') {
      const countText =
        dataSyncProgress.total > 0
          ? ` (${dataSyncProgress.completed}/${dataSyncProgress.total})`
          : '';
      return {
        message: `${t('routesScreen.downloadingGps')}${countText}` as string,
        phase: 2,
      };
    }
    // Phase 3: Analysing routes (section detection)
    if (dataSyncProgress.status === 'computing') {
      const stage = t('cache.analyzingRoutes') as string;
      return { message: progressLine(stage, dataSyncProgress.percent, t), phase: 3 };
    }
    if (isAnalysingInBackground) {
      return { message: dataSyncProgress.message, phase: 3 };
    }
    return null;
  }, [dataSyncProgress, isDataSyncing, isAnalysingInBackground, isFetchingExtended, t]);

  const renderSharedRouteState = useCallback(
    () => (
      <RouteTabEngineState
        isDark={isDark}
        showDateRangeSummary={isRouteMatchingEnabled}
        activityCount={activityCount}
        oldestSyncedDate={oldestSyncedDate}
        newestSyncedDate={newestSyncedDate}
        routesDataReady={!!routesData}
        syncMessage={
          timelineSyncProgress?.message || (groupsDirty ? t('routesScreen.computingRoutes') : null)
        }
      />
    ),
    [
      activityCount,
      groupsDirty,
      isDark,
      isRouteMatchingEnabled,
      newestSyncedDate,
      oldestSyncedDate,
      routesData,
      t,
      timelineSyncProgress?.message,
    ]
  );

  // Per-tab memos isolate re-render blast radius: changing insights
  // doesn't recreate routes/sections JSX and vice versa.
  const insightsPage = useMemo(
    () => (
      <InsightsPanel
        key="insights"
        insights={insights}
        failed={failed}
        onRetry={retry}
        hrvWithheldSince={hrvWithheldSince}
        form={form}
        initialInsightId={insightId}
        onInsightOpened={handleInsightOpened}
      />
    ),
    [insights, failed, retry, hrvWithheldSince, form, insightId, handleInsightOpened]
  );

  const routesPage = useMemo(
    () => (
      <View key="routes" style={styles.routeTabPage}>
        <RoutesList
          onRefresh={handleRefresh}
          isRefreshing={isDataSyncing}
          batchGroups={routesData?.groups ?? []}
          onLoadMore={loadMoreGroups}
          hasMore={hasMoreGroups}
          userLocation={userLocation}
          totalGroupCount={routeGroupCount}
          shownGroupCount={routesData?.filteredGroupCount ?? routeGroupCount}
          sortOption={routeSort}
          onSortChange={handleRouteSortChange}
          searchQuery={routeSearch}
          onSearchChange={setRouteSearch}
          sportOptions={routesData?.availableSportTypes}
          sportType={routeSport}
          onSportChange={setRouteSport}
          onClearFilters={clearRouteFilters}
          isLoading={!routesData}
          loadError={routesLoadError}
          onRetry={retryRoutesRead}
          emptyReason={routesData?.groupEmptyReason}
        />
      </View>
    ),
    [
      handleRefresh,
      isDataSyncing,
      routesData,
      routesLoadError,
      retryRoutesRead,
      loadMoreGroups,
      hasMoreGroups,
      userLocation,
      routeGroupCount,
      routeSort,
      routeSearch,
      routeSport,
      handleRouteSortChange,
      clearRouteFilters,
    ]
  );

  const sectionsPage = useMemo(
    () => (
      <View key="sections" style={styles.routeTabPage}>
        <SectionsList
          batchSections={routesData?.sections}
          onLoadMore={loadMoreSections}
          hasMore={hasMoreSections}
          totalSectionCount={totalSections}
          shownSectionCount={shownSections}
          userLocation={userLocation}
          sortOption={sectionSort}
          onSortChange={handleSectionSortChange}
          searchQuery={sectionSearch}
          onSearchChange={setSectionSearch}
          sportOptions={routesData?.availableSportTypes}
          sportType={sectionSport}
          onSportChange={setSectionSport}
          hiddenFilters={sectionHidden}
          onHiddenFiltersChange={setSectionHidden}
          onClearFilters={clearSectionFilters}
          unacceptedAutoCount={routesData?.unacceptedAutoCount ?? 0}
          acceptedAutoCount={routesData?.acceptedAutoCount ?? 0}
          customSectionCount={customSectionCount}
          retiredSectionCount={routesData?.retiredCount ?? 0}
          loadError={routesLoadError}
          onRetry={retryRoutesRead}
          emptyReason={routesData?.sectionEmptyReason}
        />
      </View>
    ),
    [
      routesData?.sections,
      loadMoreSections,
      hasMoreSections,
      totalSections,
      shownSections,
      userLocation,
      sectionSort,
      sectionSearch,
      sectionHidden,
      sectionSport,
      routesData?.availableSportTypes,
      routesData?.unacceptedAutoCount,
      routesData?.acceptedAutoCount,
      routesData?.retiredCount,
      routesData?.sectionEmptyReason,
      customSectionCount,
      handleSectionSortChange,
      clearSectionFilters,
      routesLoadError,
      retryRoutesRead,
    ]
  );

  // The title is the native header's. Its trailing items say the screen is a beta, a 2026-04-11
  // decision, and open what the active page is about.
  const headerOptions = useMemo(
    () => ({
      headerRight: () => (
        <View style={styles.headerActions}>
          <View
            testID="insights-beta-marker"
            style={[styles.betaMarker, isDark && styles.betaMarkerDark]}
          >
            <Text style={[styles.betaText, isDark && styles.betaTextDark]}>
              {t('insights.beta')}
            </Text>
          </View>
          <IconButton
            testID="insights-about-button"
            accessibilityLabel={t('insights.aboutTitle')}
            onPress={() =>
              inform({ title: t('insights.aboutTitle'), message: aboutInsightsBody(t, activeTab) })
            }
          >
            <MaterialCommunityIcons
              name="information-outline"
              size={20}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          </IconButton>
        </View>
      ),
    }),
    [isDark, t, activeTab]
  );

  // One page per tab, in the tabs' own order. The strip renders page N for
  // tab N, so pages built on conditions of their own land under the wrong tab.
  const tabPages = useMemo(
    () =>
      tabs.map((tab) => {
        switch (tab.key as TabType) {
          case 'strength':
            return (
              <StrengthTab
                key="strength"
                awaitingDownload={strengthTab === 'awaiting' || strengthTab === 'downloading'}
                linkedPeriod={strengthPeriodLink}
              />
            );
          case 'routes':
            return routesPage;
          case 'sections':
            return sectionsPage;
          default:
            return insightsPage;
        }
      }),
    [tabs, insightsPage, routesPage, sectionsPage, strengthTab, strengthPeriodLink]
  );

  return (
    <ScreenSafeAreaView
      hasNativeHeader
      style={[styles.container, isDark && styles.containerDark]}
      testID="routes-screen"
    >
      <Stack.Screen options={headerOptions} />
      {!isRouteMatchingEnabled && (
        <View style={styles.disabledHintRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => useRouteSettings.getState().setEnabled(true)}
            style={pressable(styles.disabledHint)}
            hitSlop={slopToMinTapTarget(DISABLED_HINT_HEIGHT)}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons
              name="map-marker-off-outline"
              size={14}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <View>
              <Text style={[styles.disabledHintText, isDark && styles.textSecondary]}>
                {t('insights.routesDisabledLine1', 'Routes & Sections disabled')}
              </Text>
              <Text style={[styles.disabledHintLink, isDark && { color: darkColors.linkTeal }]}>
                {t('insights.routesDisabledLine2', 'Turn on routes and sections')}
              </Text>
            </View>
          </Pressable>
        </View>
      )}

      {renderSharedRouteState()}

      <SwipeableTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as TabType)}
        isDark={isDark}
        lazy
      >
        {tabPages}
      </SwipeableTabs>
    </ScreenSafeAreaView>
  );
}

// Two caption lines inside the pill's padding.
const DISABLED_HINT_HEIGHT =
  typography.caption.lineHeight + typography.label.lineHeight + 2 * spacing.xxs;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  disabledHintRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  disabledHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    minHeight: DISABLED_HINT_HEIGHT,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colorWithOpacity(colors.warning, 0.1),
  },
  disabledHintText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  disabledHintLink: {
    fontSize: typography.label.fontSize,
    color: colors.linkTeal,
    fontWeight: '500',
  },
  betaMarker: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: layout.borderRadiusFull,
    paddingHorizontal: spacing.xs,
  },
  betaMarkerDark: {
    borderColor: darkColors.primary,
  },
  betaText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.linkTeal,
  },
  betaTextDark: {
    color: darkColors.linkTeal,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  routeTabPage: {
    flex: 1,
  },
});

export default withScreenBoundary(InsightsScreenContent, 'Insights');
