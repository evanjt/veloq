import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Stack, useIsFocused } from 'expo-router';
import type { SearchBarCommands } from 'react-native-screens';
import {
  View,
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  RefreshControl,
  StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from 'react-native-paper';
import {
  ScreenSafeAreaView,
  ErrorState,
  ComponentErrorBoundary,
  ActivityCardSkeleton,
  useScrollEndInset,
  canDrawProfilePhoto,
  IconButton,
  useLargeText,
  EmptyState,
} from '@/shared/ui';
import { logScreenRender, PERF_DEBUG } from '@/shared/debug/renderTimer';
import { RestoreOfferCard, StreamConsentCard, useDashboardPreferences } from '@/features/settings';
import { tapTo } from '@/shared/app/navigation';
import { queryKeys } from '@/shared/query/queryKeys';
import { onPullRefresh } from '@/shared/ui/haptics';
import { isReduceMotionOn } from '@/shared/ui/reduceMotion';
import { useScrollToTopOnReselect } from '@/shared/ui/tabReselect';
import { useSyncRefreshNotice } from '@/shared/native/useSyncRefreshNotice';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useSyncLastErrorReason, useSyncState } from '@/shared/native/useSyncStatus';
import { useEngineReadState } from '@/shared/native/useEngineSubscription';
import { EngineUnavailableState } from '@/shared/app/EngineUnavailableState';
import {
  useInfiniteActivities,
  useFeedSearch,
  useActivitySectionHighlights,
  ActivityCard,
  setVisibleRange,
  createScrollHold,
} from '@/features/activity';
import { useStrengthCardData } from '@/features/strength';
import { isInfiniteActivitiesStale } from '@/shared/query/activitiesCache';
import { useTheme, useStableBy } from '@/shared/app';
import type { Activity } from '@/types';
import {
  SummaryCard,
  NotificationOptInCard,
  SupportCard,
  FeedFirstSyncStandby,
  FeedEmptyLibrary,
  useSummaryCardData,
  useStartupData,
  feedEmptyState,
  summaryCardTarget,
} from '@/features/home';
import { RecordFAB, PendingUploadsCard } from '@/features/recording';
import {
  initCameraOverrides,
  initTerrainPreviewCache,
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps';
import { colors, darkColors, iconSize, layout, opacity, spacing, typography } from '@/theme';
import { createSharedStyles } from '@/styles';
import {
  CARD_MARGIN,
  ESTIMATED_FILTER_SECTION_HEIGHT,
  FeedFilterChips,
  feedFilterLabelKeys,
  feedRangeForPreset,
  isFeedFiltered,
  isFeedSearch,
  searchOffsetCorrection,
  useRangeActivities,
  type FeedGroup,
  type FeedRange,
  type FeedRangePreset,
} from '@/features/activity';
import { headPreviewIds, setFeedHeadIds } from '@/shared/activity/feedHead';
import { formatLocalDate } from '@/shared/format/format';
import { filterSummary } from '@/shared/format/filterSummary';
import { debug } from '@/shared/debug/debug';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const log = debug.create('Feed');
const PROFILE_BUTTON_SIZE = 36;

// iOS applies the estimate before layout; the section's onLayout sets the measured offset.
const INITIAL_CONTENT_OFFSET = { x: 0, y: ESTIMATED_FILTER_SECTION_HEIGHT } as const;
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
  const scrollEndInset = useScrollEndInset({ insetTaken: true });
  const listContentStyle = useMemo(
    () => ({ paddingBottom: spacing.xl + scrollEndInset }),
    [scrollEndInset]
  );
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
  // No preview render starts while the list moves, so the scroll keeps the cores.
  const [scrollHold] = useState(createScrollHold);
  useEffect(
    () => scrollHold.connect((held) => snapshotRef.current?.holdForScroll(held)),
    [scrollHold]
  );
  useEffect(() => {
    const timeout = setTimeout(() => setSnapshotWebViewReady(true), 500);
    return () => clearTimeout(timeout);
  }, []);

  // Past the dense cap the pinned cards can fill the window, so they move into
  // the list header and scroll with the feed.
  const largeText = useLargeText();

  // FlatList ref for scroll-to-reveal filters
  const listRef = useRef<FlatList>(null);
  // How far the list opens scrolled: the filter section, and the cards above
  // it while they sit in the list header.
  const hiddenHeadHeight = useRef(ESTIMATED_FILTER_SECTION_HEIGHT);
  // Where the filter section starts: below the cards while they sit in the list header.
  const filterSectionTop = useRef(0);
  const searchOffsetCorrected = useRef(false);
  const wasFeedFocused = useRef(isFeedFocused);

  // Initialise terrain preview cache and camera overrides on mount
  useEffect(() => {
    initTerrainPreviewCache();
    initCameraOverrides();
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
    heroKeyColor,
    heroZone,
    heroTrend,
    heroAccessibilityLabel,
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
  // match" for any older activity. A range keeps its own windowed read, and it
  // narrows the feed all the same: its chips stay on screen and its count shows.
  const searching = isFeedSearch({ searchText: searchQuery, groups: selectedTypeGroups });
  const filtered = isFeedFiltered({
    searchText: searchQuery,
    groups: selectedTypeGroups,
    range: feedRange,
  });
  useEffect(() => {
    const returned = isFeedFocused && !wasFeedFocused.current;
    wasFeedFocused.current = isFeedFocused;
    if (returned && !filtered) {
      listRef.current?.scrollToOffset({ offset: hiddenHeadHeight.current, animated: false });
    }
  }, [isFeedFocused, filtered]);
  // A reselect opens the list as the tab does, the search and filters hidden above it. A filter
  // keeps its section in view, where its chips and match count sit above the first result.
  useScrollToTopOnReselect('/', listRef, () =>
    filtered ? filterSectionTop.current : hiddenHeadHeight.current
  );
  // The search field is in the header, so a query typed into it opens the list at the filter
  // section, where the match count and the chips sit above the first result.
  const hasQuery = searchQuery.trim().length > 0;
  useEffect(() => {
    if (hasQuery) {
      listRef.current?.scrollToOffset({ offset: filterSectionTop.current, animated: false });
    }
  }, [hasQuery]);
  const search = useFeedSearch(searchQuery, selectedTypeGroups, feedRange);
  const filteredActivities = searching ? search.activities : allActivities;
  // The header's search field holds its own text, so clearing the query clears the field too.
  const searchBarRef = useRef<SearchBarCommands | null>(null);
  const clearFilters = useCallback(() => {
    searchBarRef.current?.clearText();
    setSearchQuery('');
    setSelectedTypeGroups(new Set());
    setRangePreset(null);
  }, []);

  // What the feed draws when it has no cards. A first launch is its own case:
  // the query resolves empty long before the first sync has stored anything,
  // so every other loading state is already false by then. A first sync that
  // stopped short is another: the engine's reason says why nothing arrived.
  const syncState = useSyncState();
  const lastErrorReason = useSyncLastErrorReason();
  const engineState = useEngineReadState();
  const emptyState = feedEmptyState({
    storedCount: filteredActivities.length,
    syncState: syncState ?? undefined,
    lastErrorReason,
    isError: searching ? search.isError : isError,
    isLoading: searching ? search.isLoading : isLoading,
    hasFilter: filtered,
    engine: engineState,
  });
  const standingBy = emptyState === 'standby';
  const { requestRefresh } = useSyncRefreshNotice();

  // Batch-fetch section highlights (PRs) for the whole loaded feed. Keying this
  // on the filtered list would re-read the bundle on every search keystroke,
  // and each card looks its own id up in the returned map anyway. A search
  // reaches activities no loaded page holds, so only those are added to it.
  const searchActivities = search.activities;
  const highlightIds = useMemo(() => {
    const loaded = allActivities.map((a: Activity) => a.id);
    if (!searching) return loaded;
    const held = new Set(loaded);
    const reached = searchActivities.filter((a) => !held.has(a.id)).map((a) => a.id);
    return reached.length === 0 ? loaded : [...loaded, ...reached];
  }, [allActivities, searching, searchActivities]);
  const {
    sections: sectionHighlightsMap,
    routes: routeHighlightsMap,
    newGround: newGroundMap,
    strengthCards: strengthCardRows,
  } = useActivitySectionHighlights(highlightIds);
  const strengthCards = useStrengthCardData(strengthCardRows);

  // Comprehensive refresh: invalidates feed (stale-while-revalidate), triggers route engine sync
  const handleRefresh = useMemo(
    () =>
      onPullRefresh(async () => {
        setPullRefreshing(true);
        try {
          requestRefresh();
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
          // Re-hide the filter section after refresh (if no active filter)
          if (!filtered) {
            setTimeout(() => {
              listRef.current?.scrollToOffset({
                offset: hiddenHeadHeight.current,
                animated: !isReduceMotionOn(),
              });
            }, 100);
          }
        } finally {
          setPullRefreshing(false);
        }
      }),
    [queryClient, refetchSummary, refreshStartupData, filtered, requestRefresh]
  );

  // Load more when scrolling to the end, from whichever read the list holds
  const {
    hasNextPage: searchHasNextPage,
    isFetchingNextPage: searchFetchingNextPage,
    fetchNextPage: fetchNextSearchPage,
  } = search;
  const handleEndReached = useCallback(() => {
    if (searching) {
      if (searchHasNextPage && !searchFetchingNextPage) fetchNextSearchPage();
      return;
    }
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [
    searching,
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
    if (!searching && hasPreviousPage && !isFetchingPreviousPage) {
      fetchPreviousPage();
    }
  }, [searching, hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage]);

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
        newGround={newGroundMap.get(item.id)}
        strengthData={strengthCards.get(item.id)}
      />
    ),
    [
      snapshotWebViewReady,
      isDark,
      sectionHighlightsMap,
      routeHighlightsMap,
      newGroundMap,
      strengthCards,
      previewTracks,
    ]
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
    tapTo('/settings');
  }, []);

  const navigateToHeroMetric = useCallback(() => {
    tapTo(summaryCardTarget(summaryCard.heroMetric));
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
      // The section's top is the height of whatever the header holds above it.
      const { y, height } = event.nativeEvent.layout;
      const measured = y + height;
      const offset = searchOffsetCorrection({
        measured,
        applied: Platform.OS === 'ios' ? ESTIMATED_FILTER_SECTION_HEIGHT : 0,
        filtering: filtered,
        corrected: searchOffsetCorrected.current,
      });
      if (measured > 0) hiddenHeadHeight.current = Math.round(measured);
      filterSectionTop.current = Math.round(y);
      if (offset === null) return;
      searchOffsetCorrected.current = true;
      listRef.current?.scrollToOffset({ offset, animated: false });
    },
    [filtered]
  );

  // The search field and Settings are the header's, so both are there on the first frame. Settings
  // sits in the summary card while the card is on, and in the header's trailing items otherwise.
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const showProfileButton = !summaryCard.enabled;
  const headerOptions = useMemo(
    () => ({
      headerSearchBarOptions: {
        ref: searchBarRef,
        placeholder: t('feed.searchPlaceholder'),
        autoCapitalize: 'none' as const,
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setSearchQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setSearchQuery(''),
        onClose: () => setSearchQuery(''),
        tintColor: colors.primary,
        textColor: textPrimary,
        hintTextColor: textSecondary,
        headerIconColor: textPrimary,
      },
      // Always a function: the stack merges options, so a key left out keeps the last button.
      headerRight: () =>
        showProfileButton ? (
          <IconButton
            testID="home-profile-button"
            onPress={navigateToSettings}
            accessibilityLabel={t('navigation.settings')}
            style={[styles.headerProfile, isDark && styles.headerProfileDark]}
          >
            {canDrawProfilePhoto(profileUrl, profileImageFailed) ? (
              <Image
                accessibilityIgnoresInvertColors
                source={{ uri: profileUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onError={() => setProfileImageFailed(true)}
              />
            ) : (
              <MaterialCommunityIcons name="account" size={iconSize.md} color={textSecondary} />
            )}
          </IconButton>
        ) : null,
    }),
    [
      t,
      isDark,
      textPrimary,
      textSecondary,
      showProfileButton,
      navigateToSettings,
      profileUrl,
      profileImageFailed,
    ]
  );

  // List header: filter chips + section title
  const renderListHeader = useCallback(
    () => (
      <>
        {/* Filter chips - initially hidden by scrollToOffset */}
        <View
          testID="home-filter-section"
          style={styles.filterSection}
          onLayout={handleSearchSectionLayout}
        >
          <FeedFilterChips
            selected={selectedTypeGroups}
            onSelect={selectTypeGroup}
            selectedRange={rangePreset}
            onSelectRange={selectRange}
          />
        </View>

        {/* The engine's count of what the filters leave, whichever filter is on */}
        {filtered ? (
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              {t('feed.activitiesCount', { count: search.matchedCount })}
            </Text>
          </View>
        ) : null}
      </>
    ),
    [
      isDark,
      selectedTypeGroups,
      filtered,
      search.matchedCount,
      t,
      selectTypeGroup,
      rangePreset,
      selectRange,
      handleSearchSectionLayout,
    ]
  );

  const renderFilteredEmpty = useCallback(
    () => (
      <EmptyState
        testID="home-empty-state"
        icon="filter-remove-outline"
        title={t('feed.noActivitiesFor', {
          filters: filterSummary(
            t,
            searchQuery,
            feedFilterLabelKeys(selectedTypeGroups, rangePreset).map(
              (key) => t(key as never) as string
            )
          ),
        })}
        actionLabel={t('common.clearFilters')}
        onAction={clearFilters}
        actionTestID="home-clear-filters"
      />
    ),
    [searchQuery, selectedTypeGroups, rangePreset, clearFilters, t]
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

  const { refetch: refetchSearch, error: searchError } = search;
  const renderError = useCallback(() => {
    return (
      <ErrorState
        error={searching ? searchError : error}
        fallbackKey="feed.failedToLoad"
        onRetry={() => (searching ? refetchSearch() : refetch())}
      />
    );
  }, [searching, searchError, error, refetchSearch, refetch]);

  const renderListEmpty = useCallback(() => {
    switch (emptyState) {
      case 'error':
        return renderError();
      case 'engineUnavailable':
        return <EngineUnavailableState />;
      case 'standby':
        return renderStandby();
      case 'skeletons':
        return renderSkeletons();
      case 'paused':
      case 'authExpired':
      case 'failed':
        return <FeedEmptyLibrary state={emptyState} onRetry={handleRefresh} />;
      default:
        return filtered ? (
          renderFilteredEmpty()
        ) : (
          <FeedEmptyLibrary state="empty" onRetry={handleRefresh} />
        );
    }
  }, [
    emptyState,
    filtered,
    handleRefresh,
    renderError,
    renderStandby,
    renderSkeletons,
    renderFilteredEmpty,
  ]);

  const loadingMore = searching ? search.isFetchingNextPage : isFetchingNextPage;
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

  // The cards above the feed, pinned at ordinary text sizes.
  const headCards = (
    <>
      <View testID="home-pinned-cards" style={styles.homeCards}>
        <StreamConsentCard />
        <RestoreOfferCard />
        <NotificationOptInCard libraryCount={allActivities.length} />
        <SupportCard />
        <PendingUploadsCard />
        {summaryCard.enabled && !standingBy ? (
          <SummaryCard
            profileUrl={profileUrl}
            onProfilePress={navigateToSettings}
            heroMetric={heroMetric}
            heroValue={heroValue}
            heroLabel={heroLabel}
            heroKeyColor={heroKeyColor}
            heroZone={heroZone}
            heroTrend={heroTrend}
            heroAccessibilityLabel={heroAccessibilityLabel}
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
        ) : null}
      </View>
    </>
  );

  // Single layout path - no separate loading tree to avoid component tree swap and layout bounce
  return (
    <ScreenSafeAreaView style={shared.container} testID="home-screen">
      <Stack.Screen options={headerOptions} />
      {!largeText && headCards}

      <FlatList
        ref={listRef}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onScrollBeginDrag={scrollHold.onScrollBeginDrag}
        onScrollEndDrag={scrollHold.onScrollEndDrag}
        onMomentumScrollBegin={scrollHold.onMomentumScrollBegin}
        onMomentumScrollEnd={scrollHold.onMomentumScrollEnd}
        testID="home-activity-list"
        data={filteredActivities}
        renderItem={renderActivity}
        keyExtractor={(item) => item.id}
        extraData={isDark}
        ListHeaderComponent={
          largeText ? (
            <>
              {headCards}
              {renderListHeader()}
            </>
          ) : (
            renderListHeader
          )
        }
        ListEmptyComponent={renderListEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={listContentStyle}
        contentOffset={INITIAL_CONTENT_OFFSET}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        onStartReached={handleStartReached}
        onStartReachedThreshold={0.5}
        maintainVisibleContentPosition={
          !searching && hasPreviousPage ? { minIndexForVisible: 0 } : undefined
        }
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        maxToRenderPerBatch={Platform.OS === 'ios' ? 4 : 3}
        windowSize={Platform.OS === 'ios' ? 7 : 5}
        initialNumToRender={2}
      />

      <RecordFAB />

      {/* Hidden WebView for generating 3D terrain snapshots - deferred to avoid startup cost */}
      {snapshotWebViewReady ? (
        <ComponentErrorBoundary
          part="terrainSnapshots"
          debugName="3D Terrain Snapshots"
          onError={() => setSnapshotWebViewReady(false)}
        >
          <TerrainSnapshotWebView ref={snapshotRef} suspended={!isFeedFocused} />
        </ComponentErrorBoundary>
      ) : null}
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  // The list opens with its filter section scrolled exactly past, so the gap
  // above the first activity card is this padding. Pinned, it sits outside the
  // scroll; past the dense cap the cards scroll and it sits above the filters.
  // The side inset is the activity card's margin, so the pinned cards and the
  // list share one edge, and no pinned card adds a margin of its own.
  homeCards: {
    paddingHorizontal: CARD_MARGIN,
    paddingBottom: CARD_MARGIN,
    gap: spacing.sm,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },

  // Filter section (inside ListHeaderComponent, initially scrolled past)
  // Shown, it keeps the card spacing on both sides: the pinned cards' padding
  // above, its own below.
  filterSection: {
    paddingBottom: CARD_MARGIN,
  },
  headerProfile: {
    width: PROFILE_BUTTON_SIZE,
    height: PROFILE_BUTTON_SIZE,
    borderRadius: layout.borderRadiusFull,
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
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  footerText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});

export default withScreenBoundary(FeedScreenContent, 'Feed');
