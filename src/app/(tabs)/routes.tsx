import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  ScreenErrorBoundary,
  ScreenSafeAreaView,
  SwipeableTabs,
  type SwipeableTab,
} from '@/components/ui';
import { InsightsPanel } from '@/components/insights';
import { StrengthTab } from '@/components/insights/StrengthTab';
import { DateRangeSummary, RoutesList, SectionsList, SyncDebugTab } from '@/components';
import type { RoutesSortOption } from '@/components/routes/RoutesList';
import type { SectionsSortOption } from '@/components/routes/SectionsList';
import {
  useActivityBoundsCache,
  useCustomSections,
  useInsights,
  useTheme,
  useRoutesScreenData,
  useUserLocation,
} from '@/hooks';
import { useHasStrengthData } from '@/hooks/activities/useStrengthVolume';
import { useRouteNameGeocoding } from '@/hooks/routes/useRouteNameGeocoding';
import { useRouteSettings, useSyncDateRange, useDebugStore, useEngineStatus } from '@/providers';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { colors, darkColors, spacing } from '@/theme';

type TabType = 'insights' | 'strength' | 'routes' | 'sections' | 'debug';

function RouteTabDisabledState({ isDark }: { isDark: boolean }) {
  const { t } = useTranslation();

  return (
    <View style={[styles.routeMessageCard, isDark && styles.routeMessageCardDark]}>
      <MaterialCommunityIcons
        name="map-marker-off"
        size={18}
        color={isDark ? '#FBBF24' : '#92400E'}
      />
      <View style={styles.routeMessageText}>
        <Text style={[styles.routeMessageTitle, isDark && styles.routeMessageTitleDark]}>
          {t('routesScreen.matchingDisabled')}
        </Text>
        <Text style={[styles.routeMessageBody, isDark && styles.routeMessageBodyDark]}>
          {t('routesScreen.goToSettings')}
        </Text>
      </View>
      <IconButton
        icon="cog"
        size={18}
        iconColor={isDark ? '#FBBF24' : '#92400E'}
        onPress={() => router.push('/settings')}
        style={styles.routeMessageButton}
      />
    </View>
  );
}

function RouteTabEngineState({
  isDark,
  engineInitFailed,
  engineBannerDismissed,
  onDismissEngineBanner,
  showDateRangeSummary,
  activityCount,
  oldestSyncedDate,
  newestSyncedDate,
  routesDataReady,
  syncMessage,
}: {
  isDark: boolean;
  engineInitFailed: boolean;
  engineBannerDismissed: boolean;
  onDismissEngineBanner: () => void;
  showDateRangeSummary: boolean;
  activityCount: number;
  oldestSyncedDate: string | null;
  newestSyncedDate: string | null;
  routesDataReady: boolean;
  syncMessage: string | null;
}) {
  const { t } = useTranslation();

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

      {engineInitFailed && !engineBannerDismissed ? (
        <View style={[styles.engineBanner, isDark && styles.engineBannerDark]}>
          <MaterialCommunityIcons
            name="alert-outline"
            size={16}
            color={isDark ? '#FBBF24' : '#92400E'}
          />
          <Text style={[styles.engineBannerText, isDark && styles.engineBannerTextDark]}>
            {t('engine.initFailed')}
          </Text>
          <IconButton
            icon="close"
            size={16}
            iconColor={isDark ? '#FBBF24' : '#92400E'}
            onPress={onDismissEngineBanner}
            style={styles.engineBannerClose}
          />
        </View>
      ) : null}
    </>
  );
}

export default function RoutesScreen() {
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('RoutesScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const { insights, markAsSeen } = useInsights();
  const hasStrength = useHasStrengthData();
  const { location: userLocation, requestPermission } = useUserLocation();
  const routeSortTouchedRef = useRef(false);
  const sectionSortTouchedRef = useRef(false);
  const [routeSort, setRouteSort] = useState<RoutesSortOption>(
    userLocation ? 'nearby' : 'activities'
  );
  const [sectionSort, setSectionSort] = useState<SectionsSortOption>(
    userLocation ? 'nearby' : 'visits'
  );

  const routeSettings = useRouteSettings((s) => s.settings);
  const isRouteMatchingEnabled = routeSettings.enabled;
  useRouteNameGeocoding(isRouteMatchingEnabled);

  const debugEnabled = useDebugStore((s) => s.enabled);
  const engineInitFailed = useEngineStatus((s) => s.initFailed);
  const engineBannerDismissed = useEngineStatus((s) => s.engineBannerDismissed);
  const setEngineBannerDismissed = useEngineStatus((s) => s.setEngineBannerDismissed);

  const {
    data: routesData,
    loadMoreGroups,
    loadMoreSections,
    hasMoreGroups,
    hasMoreSections,
  } = useRoutesScreenData({
    groupLimit: 50,
    sectionLimit: 100,
    prioritizeNearestGroups: routeSort === 'nearby',
    prioritizeNearestSections: sectionSort === 'nearby',
    userLocation,
  });

  const routeGroupCount = routesData?.groupCount ?? 0;
  const groupsDirty = routesData?.groupsDirty ?? false;

  const { count: customSectionCount } = useCustomSections();
  const rustSectionCount = routesData?.sectionCount ?? 0;
  const batchCustomCount =
    routesData?.sections?.filter((s) => s.id.startsWith('custom_')).length ?? 0;
  const totalSections = rustSectionCount + Math.max(0, customSectionCount - batchCustomCount);

  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);
  const dataSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isDataSyncing = useSyncDateRange((s) => s.isGpsSyncing);

  const { sync: triggerSync } = useActivityBoundsCache();

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
    if (tab === 'strength' && hasStrength) return 'strength';
    if (tab === 'routes' || tab === 'sections' || tab === 'debug' || tab === 'insights') {
      return tab;
    }
    return 'insights';
  });

  useEffect(() => {
    markAsSeen();
  }, [markAsSeen]);

  useEffect(() => {
    if (!tab) return;
    if (tab === 'strength' && hasStrength) {
      setActiveTab('strength');
      return;
    }
    if (availableTabKeys.has(tab)) {
      setActiveTab(tab as TabType);
    }
  }, [availableTabKeys, hasStrength, tab]);

  useEffect(() => {
    if (!availableTabKeys.has(activeTab)) {
      setActiveTab('insights');
    }
  }, [activeTab, availableTabKeys]);

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

  const handleRefresh = useCallback(async () => {
    await triggerSync();
  }, [triggerSync]);

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
    return null;
  }, [dataSyncProgress, isDataSyncing, isFetchingExtended, t]);

  const renderSharedRouteState = useCallback(
    () => (
      <RouteTabEngineState
        isDark={isDark}
        engineInitFailed={engineInitFailed}
        engineBannerDismissed={engineBannerDismissed}
        onDismissEngineBanner={() => setEngineBannerDismissed(true)}
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
      engineBannerDismissed,
      engineInitFailed,
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
    () => <InsightsPanel key="insights" insights={insights} />,
    [insights]
  );

  const routesPage = useMemo(
    () => (
      <View key="routes" style={styles.routeTabPage}>
        {isRouteMatchingEnabled ? (
          <RoutesList
            onRefresh={handleRefresh}
            isRefreshing={isDataSyncing}
            batchGroups={routesData?.groups ?? []}
            onLoadMore={loadMoreGroups}
            hasMore={hasMoreGroups}
            userLocation={userLocation}
            totalGroupCount={routeGroupCount}
            sortOption={routeSort}
            onSortChange={handleRouteSortChange}
          />
        ) : (
          <RouteTabDisabledState isDark={isDark} />
        )}
      </View>
    ),
    [
      handleRefresh,
      isDataSyncing,
      routesData?.groups,
      loadMoreGroups,
      hasMoreGroups,
      userLocation,
      routeGroupCount,
      routeSort,
      handleRouteSortChange,
      isRouteMatchingEnabled,
      isDark,
    ]
  );

  const sectionsPage = useMemo(
    () => (
      <View key="sections" style={styles.routeTabPage}>
        {isRouteMatchingEnabled ? (
          <SectionsList
            batchSections={routesData?.sections}
            onLoadMore={loadMoreSections}
            hasMore={hasMoreSections}
            totalSectionCount={totalSections}
            userLocation={userLocation}
            sortOption={sectionSort}
            onSortChange={handleSectionSortChange}
          />
        ) : (
          <RouteTabDisabledState isDark={isDark} />
        )}
      </View>
    ),
    [
      routesData?.sections,
      loadMoreSections,
      hasMoreSections,
      totalSections,
      userLocation,
      sectionSort,
      handleSectionSortChange,
      isRouteMatchingEnabled,
      isDark,
    ]
  );

  const tabPages = useMemo(() => {
    const pages: React.ReactNode[] = [insightsPage];
    if (hasStrength) pages.push(<StrengthTab key="strength" />);
    pages.push(routesPage);
    pages.push(sectionsPage);
    if (debugEnabled) {
      pages.push(
        <View key="debug" style={styles.routeTabPage}>
          <SyncDebugTab />
        </View>
      );
    }
    return pages;
  }, [insightsPage, routesPage, sectionsPage, hasStrength, debugEnabled]);

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
                <Text style={[styles.disabledHintLink]}>
                  {t('insights.routesDisabledLine2', 'Tap to enable')}
                </Text>
              </View>
            </TouchableOpacity>
          )}
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
  disabledHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  disabledHintText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  disabledHintLink: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '500',
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
  routeTabPage: {
    flex: 1,
  },
  routeMessageCard: {
    margin: spacing.md,
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  routeMessageCardDark: {
    backgroundColor: '#3F2A17',
    borderColor: '#92400E',
  },
  routeMessageText: {
    flex: 1,
  },
  routeMessageTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
  },
  routeMessageTitleDark: {
    color: '#FDE68A',
  },
  routeMessageBody: {
    fontSize: 12,
    color: '#92400E',
    marginTop: 2,
  },
  routeMessageBodyDark: {
    color: '#FCD34D',
  },
  routeMessageButton: {
    margin: 0,
  },
  engineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  engineBannerDark: {
    backgroundColor: '#3F2A17',
    borderColor: '#92400E',
  },
  engineBannerText: {
    flex: 1,
    marginLeft: spacing.xs,
    color: '#92400E',
    fontSize: 13,
    lineHeight: 18,
  },
  engineBannerTextDark: {
    color: '#FDE68A',
  },
  engineBannerClose: {
    margin: -4,
  },
});
