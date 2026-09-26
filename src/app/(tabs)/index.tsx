import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useIsFocused } from 'expo-router';
import {
  View,
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from 'react-native-paper';
import {
  ScreenSafeAreaView,
  ErrorStatePreset,
  ScreenErrorBoundary,
  ComponentErrorBoundary,
  ActivityCardSkeleton,
  TAB_BAR_SAFE_PADDING,
  canDrawProfilePhoto,
  pressable,
} from '@/shared/ui';
import { logScreenRender, PERF_DEBUG } from '@/shared/debug/renderTimer';
import { navigateTo } from '@/shared/app/navigation';
import { queryKeys } from '@/shared/query/queryKeys';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { feedEmptyState } from '@/features/home';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import {
  useInfiniteActivities,
  useActivitySectionHighlights,
  ActivityCard,
  setVisibleRange,
} from '@/features/activity';
import { isInfiniteActivitiesStale } from '@/shared/query/activitiesCache';
import { useSummaryCardData } from '@/features/home/hooks';
import { useTheme, useStableBy } from '@/shared/app';
import type { Activity } from '@/types';
import { useDashboardPreferences } from '@/features/home/store';
import {
  SummaryCard,
  NotificationOptInCard,
  SupportCard,
  FeedFirstSyncStandby,
  FeedSyncLine,
} from '@/features/home/components';
import { RecordFAB, PendingUploadsCard } from '@/features/recording';
import { useStartupData } from '@/features/home/hooks/useStartupData';
import {
  consumePendingSnapshots,
  initCameraOverrides,
  initTerrainPreviewCache,
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';
import { createSharedStyles } from '@/styles';
import {
  ESTIMATED_SEARCH_SECTION_HEIGHT,
  FeedFilterChips,
  matchesFeedGroup,
  searchOffsetCorrection,
  type FeedGroup,
} from '@/features/activity';
import { setFeedHeadIds } from '@/shared/activity/feedHead';
import { debug } from '@/shared/debug/debug';

const log = debug.create('Feed');

// The first frame has nothing measured, so the list opens at the estimate and
// the header's own onLayout corrects it.
const INITIAL_CONTENT_OFFSET = { x: 0, y: ESTIMATED_SEARCH_SECTION_HEIGHT } as const;
/** A card counts as on screen once a tenth of it is. */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 10 } as const;

export default function FeedScreen() {
  // Performance timing - tracks total render time and sub-component costs
  const renderStart = PERF_DEBUG ? performance.now() : 0;
  const perfEndRef = useRef<(() => void) | null>(null);
  // The screen's render timer starts in render because the render is what it
  // measures. Scoped by line rather than by file: this file also holds the
  // render-time identity caches, which are a real hazard and stay reported.
  // eslint-disable-next-line react-hooks/refs
  perfEndRef.current = logScreenRender('FeedScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isDark, colors: themeColors } = useTheme();
  const shared = useMemo(() => createSharedStyles(isDark), [isDark]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeGroup, setSelectedTypeGroup] = useState<FeedGroup | null>(null);
  // A stored URL stays truthy after the image fails, so presence is not enough.
  const [profileImageFailed, setProfileImageFailed] = useState(false);

  // Basemap snapshot WebView pool - every card gets a snapshot (3D or flat),
  // so the pool always mounts; deferred so initial renders settle first
  // (cards check the cache before requesting anyway).
  const snapshotRef = useRef<TerrainSnapshotWebViewRef | null>(null);
  // The feed stays mounted behind every other tab, and so did its two snapshot
  // WebViews. They come down while it is offscreen and the queue waits.
  const isFeedFocused = useIsFocused();
  const [snapshotWebViewReady, setSnapshotWebViewReady] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setSnapshotWebViewReady(true), 500);
    return () => clearTimeout(timeout);
  }, []);

  // FlatList ref for scroll-to-reveal search
  const listRef = useRef<FlatList>(null);
  const searchSectionHeight = useRef(ESTIMATED_SEARCH_SECTION_HEIGHT);
  const searchOffsetCorrected = useRef(false);

  // Initialize terrain preview cache and camera overrides on mount
  useEffect(() => {
    initTerrainPreviewCache();
    initCameraOverrides();
    // Check for activities ingested by background notification task -
    // mount WebView workers immediately instead of waiting 500ms
    consumePendingSnapshots().then((pending) => {
      if (pending.length > 0) setSnapshotWebViewReady(true);
    });
  }, []);

  // Dashboard preferences for navigation
  const summaryCard = useDashboardPreferences((s) => s.summaryCard);

  const t1 = PERF_DEBUG ? performance.now() : 0;
  const {
    data,
    isLoading,
    isError,
    error,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteActivities();
  if (PERF_DEBUG && performance.now() - t1 > 5)
    log.log(`  ⏱ useInfiniteActivities: ${(performance.now() - t1).toFixed(1)}ms`);

  // Flatten all pages into a single array - stabilize reference to prevent
  // FlatList re-renders when TanStack Query refetches with identical data
  const allActivitiesRaw = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flat();
  }, [data]);
  const allActivities = useStableBy(allActivitiesRaw, allActivitiesRaw.map((a) => a.id).join(','));

  // One deferred FFI call for what the feed paints: summary card and GPS tracks
  const t2 = PERF_DEBUG ? performance.now() : 0;
  const previewIds = useMemo(
    () =>
      allActivities
        .filter((a) => a.stream_types?.includes('latlng'))
        .slice(0, 5)
        .map((a) => a.id),
    [allActivities]
  );
  const { data: startupData, refresh: refreshStartupData } = useStartupData(previewIds);
  // The same ids the GPS download puts at the front of its first pass, so the
  // previews on screen paint before the ones hundreds of cards down.
  useEffect(() => {
    setFeedHeadIds(previewIds);
  }, [previewIds]);
  if (PERF_DEBUG && performance.now() - t2 > 5)
    log.log(`  ⏱ useStartupData: ${(performance.now() - t2).toFixed(1)}ms`);

  // Summary card data - uses precomputed data from getStartupData to skip redundant FFI
  const t0 = PERF_DEBUG ? performance.now() : 0;
  const {
    profileUrl,
    heroMetric,
    heroValue,
    heroLabel,
    heroColor,
    heroZoneLabel,
    heroZoneColor,
    heroTrend,
    fitnessData,
    fatigueData,
    formData,
    hrvData,
    rhrData,
    showSparkline,
    supportingMetrics,
    refetch: refetchSummary,
  } = useSummaryCardData(startupData?.summaryCardData, {
    awaitPrecomputed: true,
    precomputedSparklines: startupData?.sparklines,
  });
  if (PERF_DEBUG && performance.now() - t0 > 5)
    log.log(`  ⏱ useSummaryCardData: ${(performance.now() - t0).toFixed(1)}ms`);

  if (PERF_DEBUG) {
    const hookTime = performance.now() - renderStart;
    if (hookTime > 50) log.log(`  ⏱ Total hooks: ${hookTime.toFixed(1)}ms`);
  }

  // Filter activities by search query and type
  const filteredActivities = useMemo(() => {
    let filtered = allActivities;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        (activity: Activity) =>
          activity.name?.toLowerCase().includes(query) ||
          activity.type?.toLowerCase().includes(query) ||
          activity.locality?.toLowerCase().includes(query) ||
          activity.country?.toLowerCase().includes(query)
      );
    }

    // Filter by activity type group
    if (selectedTypeGroup) {
      filtered = filtered.filter((activity: Activity) =>
        matchesFeedGroup(selectedTypeGroup, activity.type)
      );
    }

    return filtered;
  }, [allActivities, searchQuery, selectedTypeGroup]);

  // What the feed draws when it has no cards. A first launch is its own case:
  // the query resolves empty long before the first sync has stored anything,
  // so every other loading state is already false by then.
  const syncStatus = useSyncStatus();
  const emptyState = feedEmptyState({
    storedCount: filteredActivities.length,
    syncState: syncStatus?.state,
    isError,
    isLoading,
    hasFilter: Boolean(searchQuery.trim() || selectedTypeGroup),
  });
  const standingBy = emptyState === 'standby';

  // Batch-fetch section highlights (PRs) for the whole loaded feed. Keying this
  // on the filtered list would re-read the bundle on every search keystroke,
  // and each card looks its own id up in the returned map anyway.
  const highlightIds = useMemo(() => allActivities.map((a: Activity) => a.id), [allActivities]);
  const { sections: sectionHighlightsMap, routes: routeHighlightsMap } =
    useActivitySectionHighlights(highlightIds);

  // Comprehensive refresh: invalidates feed (stale-while-revalidate), triggers route engine sync
  const handleRefresh = useCallback(async () => {
    requestSyncRefresh();
    // Reset the infinite query if page params are stale (don't cover today),
    // otherwise invalidate for smooth stale-while-revalidate.
    const infiniteRefresh = isInfiniteActivitiesStale(queryClient)
      ? queryClient.resetQueries({ queryKey: queryKeys.activities.infinite.all })
      : queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });

    await Promise.all([
      infiniteRefresh,
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.wellness.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.powerCurve.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.paceCurve.all }),
      refetchSummary(),
    ]);
    // The card is painted from the startup bundle, which no query invalidation
    // reaches, so without this a refresh leaves it on whatever the last engine
    // announcement gave it while the Fitness screen shows the current number.
    refreshStartupData();
    // Retry any failed 3D terrain snapshots
    snapshotRef.current?.retryFailed();
    // Re-hide search section after refresh (if no active filter)
    if (!searchQuery && !selectedTypeGroup) {
      setTimeout(() => {
        listRef.current?.scrollToOffset({
          offset: searchSectionHeight.current,
          animated: true,
        });
      }, 100);
    }
  }, [queryClient, refetchSummary, refreshStartupData, searchQuery, selectedTypeGroup]);

  // Load more when scrolling to the end
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={isRefetching}
        onRefresh={handleRefresh}
        colors={[colors.primary]}
        tintColor={colors.primary}
        progressBackgroundColor={isDark ? darkColors.surface : colors.surface}
        title={Platform.OS === 'ios' ? t('common.pullToRefresh') : undefined}
        titleColor={
          Platform.OS === 'ios'
            ? isDark
              ? darkColors.textSecondary
              : colors.textSecondary
            : undefined
        }
      />
    ),
    [isRefetching, handleRefresh, isDark, t]
  );

  // One reference per set of previewed activities, so a startup read that comes
  // back with the same tracks does not re-key the rows. This held the map in a
  // ref and wrote it during render, which hands back the object from a render
  // React threw away.
  const previewTracks = useStableBy(
    startupData?.previewTracks,
    startupData?.previewTracks ? [...startupData.previewTracks.keys()].join(',') : 'none'
  );
  const renderActivity = useCallback(
    ({ item, index }: { item: Activity; index: number }) => (
      <ActivityCard
        activity={item}
        index={index}
        snapshotRef={snapshotRef}
        startupTrack={previewTracks?.get(item.id)}
        snapshotReady={snapshotWebViewReady}
        colorScheme={isDark}
        sectionHighlights={sectionHighlightsMap.get(item.id)}
        routeHighlight={routeHighlightsMap.get(item.id)}
      />
    ),
    [snapshotWebViewReady, isDark, sectionHighlightsMap, routeHighlightsMap, previewTracks]
  );

  // The list mounts two to three screens either side of the viewport so
  // scrolling does not blank. Generation is a different question, so the cards
  // near the viewport are published and a card asks for its render only when it
  // is one of them. The identity has to stay put or the list rejects it, which
  // is what the empty dependency list is for.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      const indices = viewableItems
        .map((item) => item.index)
        .filter((index): index is number => index !== null);
      setVisibleRange(
        indices.length > 0 ? { first: Math.min(...indices), last: Math.max(...indices) } : null
      );
    },
    []
  );

  const navigateToSettings = useCallback(() => {
    navigateTo('/settings');
  }, []);

  const navigateToHeroMetric = useCallback(() => {
    switch (summaryCard.heroMetric) {
      case 'fitness':
        navigateTo('/fitness');
        break;
      case 'hrv':
      case 'rhr':
        navigateTo('/training');
        break;
      default:
        navigateTo('/fitness');
    }
  }, [summaryCard.heroMetric]);

  const selectTypeGroup = useCallback((group: FeedGroup | null) => {
    setSelectedTypeGroup((prev) => (prev === group ? null : group));
  }, []);

  // Initial content offset to hide search section (iOS-style hidden search)
  const initialContentOffset = INITIAL_CONTENT_OFFSET;

  const handleSearchSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const measured = event.nativeEvent.layout.height;
      const offset = searchOffsetCorrection({
        measured,
        applied: ESTIMATED_SEARCH_SECTION_HEIGHT,
        filtering: Boolean(searchQuery || selectedTypeGroup),
        corrected: searchOffsetCorrected.current,
      });
      if (measured > 0) searchSectionHeight.current = Math.round(measured);
      if (offset === null) return;
      searchOffsetCorrected.current = true;
      listRef.current?.scrollToOffset({ offset, animated: false });
    },
    [searchQuery, selectedTypeGroup]
  );

  // List header: search bar + filter chips + section title
  const renderListHeader = useCallback(
    () => (
      <>
        {/* Search bar + filter chips - initially hidden by scrollToOffset */}
        <View style={styles.searchSection} onLayout={handleSearchSectionLayout}>
          <View style={styles.searchContainer}>
            <View style={[styles.searchBar, isDark && styles.searchBarDark]}>
              <MaterialCommunityIcons name="magnify" size={20} color={themeColors.textSecondary} />
              <TextInput
                testID="home-search-input"
                style={[styles.searchInput, isDark && styles.searchInputDark]}
                placeholder={t('feed.searchPlaceholder')}
                placeholderTextColor={themeColors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={Keyboard.dismiss}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                keyboardAppearance={isDark ? 'dark' : 'light'}
                enablesReturnKeyAutomatically={Platform.OS === 'ios'}
              />
              {searchQuery.length > 0 && (
                <Pressable
                  onPress={() => setSearchQuery('')}
                  accessibilityLabel={t('common.clearSearch')}
                  accessibilityRole="button"
                  style={pressable()}
                >
                  <MaterialCommunityIcons
                    name="close-circle"
                    size={18}
                    color={themeColors.textMuted}
                  />
                </Pressable>
              )}
            </View>
            {!summaryCard.enabled && (
              <Pressable
                testID="home-profile-button"
                onPress={navigateToSettings}
                accessibilityRole="button"
                accessibilityLabel={t('navigation.settings')}
                style={pressable([styles.headerProfile, isDark && styles.headerProfileDark])}
              >
                {canDrawProfilePhoto(profileUrl, profileImageFailed) ? (
                  <Image
                    source={{ uri: profileUrl }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                    onError={() => setProfileImageFailed(true)}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name="account"
                    size={18}
                    color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  />
                )}
              </Pressable>
            )}
          </View>

          {/* Filter chips - always visible below search */}
          <FeedFilterChips
            selected={selectedTypeGroup}
            onSelect={selectTypeGroup}
            isDark={isDark}
          />
        </View>

        {/* Show count only when filtering */}
        {(searchQuery || selectedTypeGroup) && (
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              {t('feed.activitiesCount', { count: filteredActivities.length })}
            </Text>
          </View>
        )}
      </>
    ),
    [
      isDark,
      searchQuery,
      selectedTypeGroup,
      filteredActivities.length,
      t,
      themeColors.textSecondary,
      themeColors.textMuted,
      selectTypeGroup,
      handleSearchSectionLayout,
      summaryCard.enabled,
      navigateToSettings,
      profileUrl,
      profileImageFailed,
    ]
  );

  const renderEmpty = useCallback(
    () => (
      <View testID="home-empty-state" style={styles.emptyContainer}>
        <Text style={[styles.emptyText, isDark && styles.textLight]}>
          {searchQuery || selectedTypeGroup
            ? t('feed.noMatchingActivities')
            : t('feed.noActivities')}
        </Text>
      </View>
    ),
    [isDark, searchQuery, selectedTypeGroup, t]
  );

  const renderSkeletons = useCallback(
    () => (
      <View testID="home-loading-skeletons">
        {[0, 1, 2].map((i) => (
          <ActivityCardSkeleton key={i} />
        ))}
      </View>
    ),
    []
  );

  const renderStandby = useCallback(() => <FeedFirstSyncStandby />, []);

  const renderError = useCallback(() => {
    return (
      <ErrorStatePreset
        message={error instanceof Error ? error.message : t('feed.failedToLoad')}
        onRetry={() => refetch()}
      />
    );
  }, [error, refetch, t]);

  const renderListEmpty = useCallback(() => {
    switch (emptyState) {
      case 'error':
        return renderError();
      case 'standby':
        return renderStandby();
      case 'skeletons':
        return renderSkeletons();
      default:
        return renderEmpty();
    }
  }, [emptyState, renderError, renderStandby, renderSkeletons, renderEmpty]);

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.footerText, isDark && styles.textDark]}>
          {t('common.loadingMore')}
        </Text>
      </View>
    );
  }, [isFetchingNextPage, isDark, t]);

  // Track what changes between renders to identify unnecessary re-renders
  const prevRenderState = useRef({
    isLoading: false,
    actLen: 0,
    refetching: false,
    dataRef: null as unknown,
    filteredRef: null as unknown,
  });
  // The render-state diff is instrumentation over the render, so every read and
  // write of it is a render-time ref access by construction. `PERF_DEBUG` is
  // `__DEV__`. Scoped by region for the same reason as the timer above.
  /* eslint-disable react-hooks/refs */
  if (PERF_DEBUG) {
    const prev = prevRenderState.current;
    const changes: string[] = [];
    if (prev.isLoading !== isLoading) changes.push(`isLoading:${prev.isLoading}→${isLoading}`);
    if (prev.actLen !== allActivities.length)
      changes.push(`activities:${prev.actLen}→${allActivities.length}`);
    if (prev.refetching !== isRefetching)
      changes.push(`refetching:${prev.refetching}→${isRefetching}`);
    if (prev.dataRef !== data) changes.push('data:newRef');
    if (prev.filteredRef !== filteredActivities) changes.push('filtered:newRef');
    prev.isLoading = isLoading;
    prev.actLen = allActivities.length;
    prev.refetching = isRefetching;
    prev.dataRef = data;
    prev.filteredRef = filteredActivities;

    const jsxStart = performance.now() - renderStart;
    if (jsxStart > 30)
      log.log(
        `  ⏱ Hooks→JSX: ${jsxStart.toFixed(0)}ms | activities: ${allActivities.length} | startup: ${startupData ? 'ready' : 'pending'}`
      );
    if (changes.length > 0) log.log(`  🔄 State changes: ${changes.join(', ')}`);
  }
  /* eslint-enable react-hooks/refs */

  // Single layout path - no separate loading tree to avoid component tree swap and layout bounce
  return (
    <ScreenErrorBoundary screenName="Feed">
      <ScreenSafeAreaView style={shared.container} testID="home-screen">
        {/* A first launch fills in silence otherwise, which reads as a crash.
            While standing by, the standby carries its own indicator and counts. */}
        {!standingBy && <FeedSyncLine />}
        {/* Notification opt-in card (OAuth users who haven't enabled yet) */}
        <NotificationOptInCard />
        <SupportCard />
        <PendingUploadsCard />

        {/* Summary card with hero metric and supporting stats */}
        {summaryCard.enabled && !standingBy && (
          <SummaryCard
            profileUrl={profileUrl}
            onProfilePress={navigateToSettings}
            heroMetric={heroMetric}
            heroValue={heroValue}
            heroLabel={heroLabel}
            heroColor={heroColor}
            heroZoneLabel={heroZoneLabel}
            heroZoneColor={heroZoneColor}
            heroTrend={heroTrend}
            onHeroPress={navigateToHeroMetric}
            fitnessData={fitnessData}
            fatigueData={fatigueData}
            formData={formData}
            hrvData={hrvData}
            rhrData={rhrData}
            showSparkline={showSparkline}
            supportingMetrics={supportingMetrics}
          />
        )}

        <FlatList
          ref={listRef}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY_CONFIG}
          testID="home-activity-list"
          data={filteredActivities}
          renderItem={renderActivity}
          keyExtractor={(item) => item.id}
          extraData={isDark}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={renderListEmpty}
          ListFooterComponent={renderFooter}
          contentContainerStyle={styles.listContent}
          contentOffset={initialContentOffset}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={Platform.OS === 'ios' ? 4 : 3}
          windowSize={Platform.OS === 'ios' ? 7 : 5}
          initialNumToRender={2}
        />

        <RecordFAB />

        {/* Hidden WebView for generating 3D terrain snapshots - deferred to avoid startup cost */}
        {snapshotWebViewReady && (
          <ComponentErrorBoundary
            componentName="3D Terrain Snapshots"
            showRetry={false}
            onError={() => setSnapshotWebViewReady(false)}
          >
            <TerrainSnapshotWebView ref={snapshotRef} suspended={!isFeedFocused} />
          </ComponentErrorBoundary>
        )}
      </ScreenSafeAreaView>
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },

  // Search section (inside ListHeaderComponent, initially scrolled past)
  searchSection: {
    paddingBottom: spacing.xs,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: opacity.overlay.light,
    borderRadius: layout.borderRadiusMd,
    paddingHorizontal: layout.cardMargin,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchBarDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.bodyMedium.fontSize,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchInputDark: {
    color: colors.textOnDark,
  },
  headerProfile: {
    width: 36,
    height: 36,
    borderRadius: layout.borderRadiusFull,
    marginLeft: spacing.sm,
    backgroundColor: opacity.overlay.light,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerProfileDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  sectionHeader: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorText: {
    ...typography.body,
    color: colors.errorDeep,
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  footerText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
});
