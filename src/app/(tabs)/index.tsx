import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useIsFocused } from 'expo-router';
import {
  View,
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from 'react-native-paper';
import {
  ScreenSafeAreaView,
  ErrorStatePreset,
  ComponentErrorBoundary,
  ActivityCardSkeleton,
  TAB_BAR_SAFE_PADDING,
  canDrawProfilePhoto,
  pressable,
  pressRipple,
  SearchBar,
} from '@/shared/ui';
import { logScreenRender, PERF_DEBUG } from '@/shared/debug/renderTimer';
import { StreamConsentCard } from '@/features/settings';
import { navigateTo } from '@/shared/app/navigation';
import { queryKeys } from '@/shared/query/queryKeys';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useSyncState } from '@/shared/native/useSyncStatus';
import {
  useInfiniteActivities,
  useFeedSearch,
  useActivitySectionHighlights,
  ActivityCard,
  ringsLeavingView,
  setVisibleRange,
} from '@/features/activity';
import { reportFeedDismissed } from '@/shared/native/feedSeen';
import { isInfiniteActivitiesStale } from '@/shared/query/activitiesCache';
import { useTheme, useStableBy } from '@/shared/app';
import type { Activity } from '@/types';
import {
  SummaryCard,
  NotificationOptInCard,
  SupportCard,
  FeedFirstSyncStandby,
  useSummaryCardData,
  useDashboardPreferences,
  useStartupData,
  feedEmptyState,
  summaryCardTarget,
} from '@/features/home';
import { RecordFAB, PendingUploadsCard } from '@/features/recording';
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
  feedRangeForPreset,
  searchOffsetCorrection,
  useRangeActivities,
  type FeedGroup,
  type FeedRange,
  type FeedRangePreset,
} from '@/features/activity';
import { headPreviewIds, setFeedHeadIds } from '@/shared/activity/feedHead';
import { formatLocalDate } from '@/shared/format/format';
import { debug } from '@/shared/debug/debug';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const log = debug.create('Feed');

// iOS applies the estimate before layout; the header's onLayout sets the measured offset.
const INITIAL_CONTENT_OFFSET = { x: 0, y: ESTIMATED_SEARCH_SECTION_HEIGHT } as const;
/** A card counts as on screen once a tenth of it is. */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 10 } as const;

/**
 * The windowed feed: from today while no range is set, otherwise the chosen
 * range read from its newest day. Both hooks stay mounted so a range toggled
 * off returns to the pages already loaded.
 */
function useFeedRange(preset: FeedRangePreset | null): FeedRange | null {
  return useMemo(
    () => (preset ? feedRangeForPreset(preset, formatLocalDate(new Date())) : null),
    [preset]
  );
}

function useWindowedFeed(range: FeedRange | null) {
  const infinite = useInfiniteActivities();
  const ranged = useRangeActivities(range);
  return range ? ranged : infinite;
}

function FeedScreenContent() {
  useTabFirstFrame('/');
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
  const { isDark } = useTheme();
  const shared = useMemo(() => createSharedStyles(isDark), [isDark]);
  const [searchQuery, setSearchQuery] = useState('');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [selectedTypeGroups, setSelectedTypeGroups] = useState<Set<FeedGroup>>(new Set());
  const [rangePreset, setRangePreset] = useState<FeedRangePreset | null>(null);
  const feedRange = useFeedRange(rangePreset);
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
  const wasFeedFocused = useRef(isFeedFocused);

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
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    fetchPreviousPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    refetch,
  } = useWindowedFeed(feedRange);
  if (PERF_DEBUG && performance.now() - t1 > 5)
    log.log(`  ⏱ useInfiniteActivities: ${(performance.now() - t1).toFixed(1)}ms`);

  // Flatten all pages into a single array - stabilize reference to prevent
  // FlatList re-renders when TanStack Query refetches with identical data
  const allActivitiesRaw = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flat();
  }, [data]);
  const allActivities = allActivitiesRaw;

  // One deferred FFI call for what the feed paints: summary card and GPS tracks
  const t2 = PERF_DEBUG ? performance.now() : 0;
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const nextPreviewIds = headPreviewIds(allActivities, hasPreviousPage, previewIds);
  if (
    nextPreviewIds.length !== previewIds.length ||
    nextPreviewIds.some((id, i) => id !== previewIds[i])
  ) {
    setPreviewIds(nextPreviewIds);
  }
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
    heroTrend,
    fitnessData,
    fitnessDelta,
    fitnessRiseDays,
    fatigueData,
    formData,
    hrvData,
    rhrData,
    hrvRead,
    rhrRead,
    showSparkline,
    supportingMetrics,
    isLoading: summaryLoading,
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

  // A search or a sport chip reads the engine over the whole library. The
  // windowed pages hold a few months at most, so filtering them answered "no
  // match" for any older activity.
  const filtering = Boolean(searchQuery.trim() || selectedTypeGroups.size > 0);
  useEffect(() => {
    const returned = isFeedFocused && !wasFeedFocused.current;
    wasFeedFocused.current = isFeedFocused;
    if (returned && !filtering) {
      listRef.current?.scrollToOffset({ offset: searchSectionHeight.current, animated: false });
    }
  }, [isFeedFocused, filtering]);
  const search = useFeedSearch(searchQuery, selectedTypeGroups, feedRange);
  const filteredActivities = filtering ? search.activities : allActivities;

  // What the feed draws when it has no cards. A first launch is its own case:
  // the query resolves empty long before the first sync has stored anything,
  // so every other loading state is already false by then.
  const syncState = useSyncState();
  const emptyState = feedEmptyState({
    storedCount: filteredActivities.length,
    syncState: syncState ?? undefined,
    isError: filtering ? search.isError : isError,
    isLoading: filtering ? search.isLoading : isLoading,
    hasFilter: filtering,
  });
  const standingBy = emptyState === 'standby';

  // Batch-fetch section highlights (PRs) for the whole loaded feed. Keying this
  // on the filtered list would re-read the bundle on every search keystroke,
  // and each card looks its own id up in the returned map anyway. A search
  // reaches activities no loaded page holds, so only those are added to it.
  const searchActivities = search.activities;
  const highlightIds = useMemo(() => {
    const loaded = allActivities.map((a: Activity) => a.id);
    if (!filtering) return loaded;
    const held = new Set(loaded);
    const reached = searchActivities.filter((a) => !held.has(a.id)).map((a) => a.id);
    return reached.length === 0 ? loaded : [...loaded, ...reached];
  }, [allActivities, filtering, searchActivities]);
  const { sections: sectionHighlightsMap, routes: routeHighlightsMap } =
    useActivitySectionHighlights(highlightIds);

  // Comprehensive refresh: invalidates feed (stale-while-revalidate), triggers route engine sync
  const handleRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      requestSyncRefresh();
      // Reset the infinite query if page params are stale (don't cover today),
      // otherwise invalidate for smooth stale-while-revalidate.
      const infiniteRefresh = isInfiniteActivitiesStale(queryClient)
        ? queryClient.resetQueries({ queryKey: queryKeys.activities.infinite.all })
        : queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });

      await Promise.all([
        infiniteRefresh,
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.range.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.search.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.wellness.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charts.powerCurve.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charts.paceCurve.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charts.bestEfforts.all }),
        refetchSummary(),
      ]);
      // The card is painted from the startup bundle, which no query invalidation
      // reaches, so without this a refresh leaves it on whatever the last engine
      // announcement gave it while the Fitness screen shows the current number.
      refreshStartupData();
      // Retry any failed 3D terrain snapshots
      snapshotRef.current?.retryFailed();
      // Re-hide search section after refresh (if no active filter)
      if (!searchQuery && selectedTypeGroups.size === 0) {
        setTimeout(() => {
          listRef.current?.scrollToOffset({
            offset: searchSectionHeight.current,
            animated: true,
          });
        }, 100);
      }
    } finally {
      setPullRefreshing(false);
    }
  }, [queryClient, refetchSummary, refreshStartupData, searchQuery, selectedTypeGroups]);

  // Load more when scrolling to the end, from whichever read the list holds
  const {
    hasNextPage: searchHasNextPage,
    isFetchingNextPage: searchFetchingNextPage,
    fetchNextPage: fetchNextSearchPage,
  } = search;
  const handleEndReached = useCallback(() => {
    if (filtering) {
      if (searchHasNextPage && !searchFetchingNextPage) fetchNextSearchPage();
      return;
    }
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [
    filtering,
    searchHasNextPage,
    searchFetchingNextPage,
    fetchNextSearchPage,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  // A search answers newest first from the whole library, so only the
  // windowed feed has newer pages to reach for.
  const handleStartReached = useCallback(() => {
    if (!filtering && hasPreviousPage && !isFetchingPreviousPage) {
      fetchPreviousPage();
    }
  }, [filtering, hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage]);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={pullRefreshing}
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
    [pullRefreshing, handleRefresh, isDark, t]
  );

  // The line itself is part of the key: a re-ingest can replace a track while
  // keeping the same activity ids in the head of the feed.
  const rawPreviewTracks = startupData?.previewTracks;
  const previewTracksKey = useMemo(
    () =>
      rawPreviewTracks
        ? JSON.stringify([...rawPreviewTracks].map(([id, track]) => [id, track.coordinates]))
        : 'none',
    [rawPreviewTracks]
  );
  const previewTracks = useStableBy(rawPreviewTracks, previewTracksKey);
  const newActivityIds = startupData?.newActivityIds;
  const currentNewActivityIds = useRef(newActivityIds);
  // eslint-disable-next-line react-hooks/refs
  currentNewActivityIds.current = newActivityIds;
  const currentRefreshStartupData = useRef(refreshStartupData);
  // eslint-disable-next-line react-hooks/refs
  currentRefreshStartupData.current = refreshStartupData;
  const seenNewActivityIds = useRef(new Set<string>());
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
        isNew={newActivityIds?.has(item.id) ?? false}
        onNewDismissed={refreshStartupData}
      />
    ),
    [
      snapshotWebViewReady,
      isDark,
      sectionHighlightsMap,
      routeHighlightsMap,
      previewTracks,
      newActivityIds,
      refreshStartupData,
    ]
  );

  // The list mounts two to three screens either side of the viewport so
  // scrolling does not blank. Generation is a different question, so the cards
  // near the viewport are published and a card asks for its render only when it
  // is one of them. The identity has to stay put or the list rejects it, which
  // is what the empty dependency list is for.
  const onViewableItemsChanged = useCallback(
    ({
      viewableItems,
      changed,
    }: {
      viewableItems: { index: number | null }[];
      changed: { key: string; isViewable: boolean }[];
    }) => {
      const indices = viewableItems
        .map((item) => item.index)
        .filter((index): index is number => index !== null);
      setVisibleRange(
        indices.length > 0 ? { first: Math.min(...indices), last: Math.max(...indices) } : null
      );
      const leaving = ringsLeavingView(
        changed,
        seenNewActivityIds.current,
        currentNewActivityIds.current ?? new Set<string>()
      );
      if (leaving.length > 0) {
        reportFeedDismissed(leaving);
        currentRefreshStartupData.current();
      }
    },
    []
  );

  const navigateToSettings = useCallback(() => {
    navigateTo('/settings');
  }, []);

  const navigateToHeroMetric = useCallback(() => {
    navigateTo(summaryCardTarget(summaryCard.heroMetric));
  }, [summaryCard.heroMetric]);

  const selectRange = useCallback((preset: FeedRangePreset) => {
    setRangePreset((prev) => (prev === preset ? null : preset));
  }, []);

  const selectTypeGroup = useCallback((group: FeedGroup) => {
    setSelectedTypeGroups((previous) => {
      const next = new Set(previous);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const handleSearchSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const measured = event.nativeEvent.layout.height;
      const offset = searchOffsetCorrection({
        measured,
        applied: Platform.OS === 'ios' ? ESTIMATED_SEARCH_SECTION_HEIGHT : 0,
        filtering: Boolean(searchQuery || selectedTypeGroups.size > 0),
        corrected: searchOffsetCorrected.current,
      });
      if (measured > 0) searchSectionHeight.current = Math.round(measured);
      if (offset === null) return;
      searchOffsetCorrected.current = true;
      listRef.current?.scrollToOffset({ offset, animated: false });
    },
    [searchQuery, selectedTypeGroups]
  );

  // List header: search bar + filter chips + section title
  const renderListHeader = useCallback(
    () => (
      <>
        {/* Search bar + filter chips - initially hidden by scrollToOffset */}
        <View style={styles.searchSection} onLayout={handleSearchSectionLayout}>
          <View style={styles.searchContainer}>
            <SearchBar
              testID="home-search-input"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('feed.searchPlaceholder')}
              style={styles.searchBar}
            />
            {!summaryCard.enabled && (
              <Pressable
                testID="home-profile-button"
                onPress={navigateToSettings}
                accessibilityRole="button"
                accessibilityLabel={t('navigation.settings')}
                style={pressable([styles.headerProfile, isDark && styles.headerProfileDark])}
                android_ripple={pressRipple}
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
            selected={selectedTypeGroups}
            onSelect={selectTypeGroup}
            selectedRange={rangePreset}
            onSelectRange={selectRange}
            isDark={isDark}
          />
        </View>

        {/* Show count only when filtering */}
        {filtering && (
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              {t('feed.activitiesCount', { count: search.matchedCount })}
            </Text>
          </View>
        )}
      </>
    ),
    [
      isDark,
      searchQuery,
      selectedTypeGroups,
      filtering,
      search.matchedCount,
      t,
      selectTypeGroup,
      rangePreset,
      selectRange,
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
          {filtering ? t('feed.noMatchingActivities') : t('feed.noActivities')}
        </Text>
      </View>
    ),
    [isDark, filtering, t]
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

  const { refetch: refetchSearch } = search;
  const renderError = useCallback(() => {
    return (
      <ErrorStatePreset
        message={t('feed.failedToLoad')}
        onRetry={() => (filtering ? refetchSearch() : refetch())}
      />
    );
  }, [filtering, refetchSearch, refetch, t]);

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

  const loadingMore = filtering ? search.isFetchingNextPage : isFetchingNextPage;
  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.footerText, isDark && styles.textDark]}>
          {t('common.loadingMore')}
        </Text>
      </View>
    );
  }, [loadingMore, isDark, t]);

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
    <ScreenSafeAreaView style={shared.container} testID="home-screen">
      <StreamConsentCard />
      <View style={styles.homeCards}>
        <NotificationOptInCard />
        <SupportCard />
        <PendingUploadsCard />
        {summaryCard.enabled && !standingBy && (
          <SummaryCard
            profileUrl={profileUrl}
            onProfilePress={navigateToSettings}
            heroMetric={heroMetric}
            heroValue={heroValue}
            heroLabel={heroLabel}
            heroColor={heroColor}
            heroTrend={heroTrend}
            onHeroPress={navigateToHeroMetric}
            fitnessData={fitnessData}
            fitnessDelta={fitnessDelta}
            fitnessRiseDays={fitnessRiseDays}
            fatigueData={fatigueData}
            formData={formData}
            hrvData={hrvData}
            rhrData={rhrData}
            hrvRead={hrvRead}
            rhrRead={rhrRead}
            showSparkline={showSparkline}
            supportingMetrics={supportingMetrics}
            isLoading={summaryLoading}
          />
        )}
      </View>

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
        contentOffset={INITIAL_CONTENT_OFFSET}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        onStartReached={handleStartReached}
        onStartReachedThreshold={0.5}
        maintainVisibleContentPosition={
          !filtering && hasPreviousPage ? { minIndexForVisible: 0 } : undefined
        }
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
  );
}

const styles = StyleSheet.create({
  homeCards: {
    paddingHorizontal: layout.screenPadding,
    gap: spacing.sm,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },

  // Search section (inside ListHeaderComponent, initially scrolled past)
  searchSection: {
    paddingTop: spacing.sm,
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

export default withScreenBoundary(FeedScreenContent, 'Feed');
