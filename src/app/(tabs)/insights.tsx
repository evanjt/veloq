import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useFocusEffect, router, useLocalSearchParams } from 'expo-router';
import { View, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ScreenSafeAreaView, SwipeableTabs, type SwipeableTab } from '@/shared/ui';
import { aboutInsightsBody, InsightsPanel, StrengthTab, useInsights } from '@/features/insights';
import {
  DateRangeSummary,
  RoutesList,
  type RoutesSortOption,
  SectionsList,
  type SectionsSortOption,
  SyncDebugTab,
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
import { useStrengthTabState } from '@/features/strength';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { isExtendedFetchRunning } from '@/shared/app/extendedFetch';
import { useDebugStore } from '@/features/settings';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { colors, darkColors, spacing, layout, typography, colorWithOpacity } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

type TabType = 'insights' | 'strength' | 'routes' | 'sections' | 'debug';

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

function InsightsScreenContent() {
  useTabFirstFrame('/insights');
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('InsightsScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { tab, insightId } = useLocalSearchParams<{ tab?: string; insightId?: string }>();
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

  const routeSettings = useRouteSettings((s) => s.settings);
  const isRouteMatchingEnabled = routeSettings.enabled;

  const debugEnabled = useDebugStore((s) => s.enabled);

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

    if (debugEnabled) {
      result.push({ key: 'debug', label: 'Sync', icon: 'bug-outline' });
    }

    return result;
  }, [debugEnabled, hasStrength, isRouteMatchingEnabled, t]);

  const availableTabKeys = useMemo(() => new Set(tabs.map((entry) => entry.key)), [tabs]);
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    // Deep-link from home insight chip - always lands on insights tab.
    if (insightId) return 'insights';
    if (tab === 'strength' && hasStrength) return 'strength';
    if (tab === 'routes' || tab === 'sections' || tab === 'debug' || tab === 'insights') {
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

  const handleRefresh = useCallback(() => {
    requestSyncRefresh();
  }, []);

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
      const pct = dataSyncProgress.percent;
      const text = t('cache.analyzingRoutes') as string;
      return { message: pct > 0 ? `${text}... ${pct}%` : `${text}...`, phase: 3 };
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
          isLoading={!routesData}
          loadError={routesLoadError}
          onRetry={retryRoutesRead}
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
          unacceptedAutoCount={routesData?.unacceptedAutoCount ?? 0}
          acceptedAutoCount={routesData?.acceptedAutoCount ?? 0}
          customSectionCount={customSectionCount}
          retiredSectionCount={routesData?.retiredCount ?? 0}
          loadError={routesLoadError}
          onRetry={retryRoutesRead}
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
      customSectionCount,
      handleSectionSortChange,
      routesLoadError,
      retryRoutesRead,
    ]
  );

  // One page per tab, in the tabs' own order. The strip renders page N for
  // tab N, so pages built on conditions of their own put the routes page
  // under the Sync tab whenever route matching was off.
  const tabPages = useMemo(
    () =>
      tabs.map((tab) => {
        switch (tab.key as TabType) {
          case 'strength':
            return (
              <StrengthTab
                key="strength"
                awaitingDownload={strengthTab === 'awaiting' || strengthTab === 'downloading'}
              />
            );
          case 'routes':
            return routesPage;
          case 'sections':
            return sectionsPage;
          case 'debug':
            return (
              <View key="debug" style={styles.routeTabPage}>
                <SyncDebugTab />
              </View>
            );
          default:
            return insightsPage;
        }
      }),
    [tabs, insightsPage, routesPage, sectionsPage, strengthTab]
  );

  return (
    <ScreenSafeAreaView
      style={[styles.container, isDark && styles.containerDark]}
      testID="routes-screen"
    >
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>
            {t('insights.title', 'Insights')}
          </Text>
          {/* Shipped as beta on the 2026-04-11 decision, and the screen says so. */}
          <View
            testID="insights-beta-marker"
            style={[styles.betaMarker, isDark && styles.betaMarkerDark]}
          >
            <Text style={[styles.betaText, isDark && styles.betaTextDark]}>
              {t('insights.beta')}
            </Text>
          </View>
        </View>
        {!isRouteMatchingEnabled && (
          <TouchableOpacity
            onPress={() => useRouteSettings.getState().setEnabled(true)}
            style={styles.disabledHint}
            activeOpacity={0.6}
          >
            <MaterialCommunityIcons
              name="map-marker-off-outline"
              size={14}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
            <View>
              <Text style={[styles.disabledHintText, isDark && styles.textMuted]}>
                {t('insights.routesDisabledLine1', 'Routes & Sections disabled')}
              </Text>
              <Text style={[styles.disabledHintLink, isDark && { color: darkColors.linkTeal }]}>
                {t('insights.routesDisabledLine2', 'Tap to enable')}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        <IconButton
          icon="information-outline"
          size={20}
          iconColor={isDark ? darkColors.textMuted : colors.textMuted}
          onPress={() => Alert.alert(t('insights.aboutTitle'), aboutInsightsBody(t, activeTab))}
          style={styles.infoButton}
        />
      </View>

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
  disabledHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  headerTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  routeTabPage: {
    flex: 1,
  },
});

export default withScreenBoundary(InsightsScreenContent, 'Insights');
