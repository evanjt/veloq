import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { Text } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { logScreenRender, PERF_DEBUG } from '@/lib/debug/renderTimer';
import { isNetworkError } from '@/lib/utils/errorHandler';
import { router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useInfiniteActivities, useTheme, useSummaryCardData } from '@/hooks';
import type { Activity } from '@/types';
import { useDashboardPreferences, useMapPreferences } from '@/providers';
import { ActivityCard, notifyMapScroll } from '@/components/activity';
import {
  ActivityCardSkeleton,
  NetworkErrorState,
  ErrorStatePreset,
  TAB_BAR_SAFE_PADDING,
} from '@/components/ui';
import { SummaryCard } from '@/components/home';
import {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/components/maps/TerrainSnapshotWebView';
import { initTerrainPreviewCache } from '@/lib/storage/terrainPreviewCache';
import { useNetwork } from '@/providers';
import { colors, darkColors, opacity, spacing, layout, typography, shadows } from '@/theme';
import { createSharedStyles } from '@/styles';

// Activity type categories for filtering
const ACTIVITY_TYPE_GROUPS = {
  Cycling: ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide'],
  Running: ['Run', 'VirtualRun', 'TrailRun'],
  Swimming: ['Swim'],
  Other: [
    'Walk',
    'Hike',
    'Workout',
    'WeightTraining',
    'Yoga',
    'Rowing',
    'Elliptical',
    'Ski',
    'Snowboard',
  ],
};

const ALL_TYPES = Object.values(ACTIVITY_TYPE_GROUPS).flat();

export default function FeedScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('FeedScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTypeGroup, setSelectedTypeGroup] = useState<string | null>(null);

  const { isOnline } = useNetwork();

  // 3D terrain snapshot WebView
  const { isAnyTerrain3DEnabled } = useMapPreferences();
  const snapshotRef = useRef<TerrainSnapshotWebViewRef | null>(null);
  const [terrainSnapshotVersion, setTerrainSnapshotVersion] = useState(0);

  // Initialize terrain preview cache on mount
  useEffect(() => {
    if (isAnyTerrain3DEnabled) {
      initTerrainPreviewCache();
    }
  }, [isAnyTerrain3DEnabled]);

  const handleSnapshotComplete = useCallback((_activityId: string, _uri: string) => {
    setTerrainSnapshotVersion((v) => v + 1);
  }, []);

  // Dashboard preferences for navigation
  const { summaryCard } = useDashboardPreferences();

  // Summary card data (hero metric, sparkline, supporting metrics)
  const {
    profileUrl,
    heroValue,
    heroLabel,
    heroColor,
    heroZoneLabel,
    heroZoneColor,
    heroTrend,
    sparklineData,
    showSparkline,
    supportingMetrics,
    refetch: refetchSummary,
  } = useSummaryCardData();

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

  // Flatten all pages into a single array
  const allActivities = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flat();
  }, [data?.pages]);

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
      const types =
        ACTIVITY_TYPE_GROUPS[selectedTypeGroup as keyof typeof ACTIVITY_TYPE_GROUPS] || [];
      filtered = filtered.filter((activity: Activity) => types.includes(activity.type));
    }

    return filtered;
  }, [allActivities, searchQuery, selectedTypeGroup]);

  // Comprehensive refresh: resets feed, triggers route engine sync, refreshes all data
  // - resetQueries forces fresh initialPageParam with today's date (fixes stale cache)
  // - Invalidating ['activities'] triggers GlobalDataSync → route engine GPS sync
  // - Invalidating wellness/curves/summary refreshes fitness and stats data
  const handleRefresh = async () => {
    await Promise.all([
      queryClient.resetQueries({ queryKey: ['activities-infinite'] }),
      queryClient.invalidateQueries({ queryKey: ['activities'] }),
      queryClient.invalidateQueries({ queryKey: ['wellness'] }),
      queryClient.invalidateQueries({ queryKey: ['athlete-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['powerCurve'] }),
      queryClient.invalidateQueries({ queryKey: ['paceCurve'] }),
      refetchSummary(),
    ]);
  };

  // Load more when scrolling to the end
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderActivity = useCallback(
    ({ item, index }: { item: Activity; index: number }) => (
      <ActivityCard
        activity={item}
        index={index}
        snapshotRef={snapshotRef}
        terrainSnapshotVersion={terrainSnapshotVersion}
      />
    ),
    [terrainSnapshotVersion]
  );

  // Notify map previews when items become visible for lazy loading
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      const maxIndex = Math.max(...viewableItems.map((item) => item.index ?? 0));
      if (maxIndex >= 0) {
        notifyMapScroll(maxIndex);
      }
    },
    []
  );

  const viewabilityConfig = useMemo(
    () => ({
      itemVisiblePercentThreshold: 20,
    }),
    []
  );

  const navigateToSettings = () => router.push('/settings' as Href);

  const navigateToHeroMetric = () => {
    switch (summaryCard.heroMetric) {
      case 'form':
      case 'fitness':
        router.push('/fitness' as Href);
        break;
      case 'hrv':
        router.push('/training' as Href);
        break;
      default:
        router.push('/fitness' as Href);
    }
  };

  const toggleFilters = () => setShowFilters(!showFilters);

  const selectTypeGroup = (group: string | null) => {
    setSelectedTypeGroup(selectedTypeGroup === group ? null : group);
  };

  // Memoized section header for FlatList - only depends on filtered count
  const renderListHeader = useCallback(
    () => (
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
          {searchQuery || selectedTypeGroup
            ? t('feed.activitiesCount', { count: filteredActivities.length })
            : t('feed.recentActivities')}
        </Text>
      </View>
    ),
    [isDark, searchQuery, selectedTypeGroup, filteredActivities.length, t]
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

  const renderError = useCallback(() => {
    if (isNetworkError(error)) {
      return <NetworkErrorState onRetry={() => refetch()} />;
    }

    return (
      <ErrorStatePreset
        message={error instanceof Error ? error.message : t('feed.failedToLoad')}
        onRetry={() => refetch()}
      />
    );
  }, [error, refetch, t]);

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

  if (isLoading && !allActivities.length) {
    return (
      <ScreenSafeAreaView style={shared.container}>
        <View style={styles.skeletonContainer}>
          {/* Summary card skeleton */}
          <View style={[styles.summaryCardSkeleton, isDark && styles.summaryCardSkeletonDark]}>
            <View style={styles.skeletonRow}>
              <View style={[styles.skeletonCircle, isDark && styles.skeletonElementDark]} />
              <View style={styles.skeletonSpacer} />
            </View>
            <View style={styles.skeletonHero}>
              <View style={[styles.skeletonHeroValue, isDark && styles.skeletonElementDark]} />
              <View style={[styles.skeletonHeroLabel, isDark && styles.skeletonElementDark]} />
            </View>
            <View style={styles.skeletonMetrics}>
              <View style={[styles.skeletonMetric, isDark && styles.skeletonElementDark]} />
              <View style={[styles.skeletonMetric, isDark && styles.skeletonElementDark]} />
              <View style={[styles.skeletonMetric, isDark && styles.skeletonElementDark]} />
            </View>
          </View>
          {/* Section header skeleton */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              {t('feed.recentActivities')}
            </Text>
          </View>
          {/* Activity card skeletons */}
          <ActivityCardSkeleton />
          <ActivityCardSkeleton />
          <ActivityCardSkeleton />
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenSafeAreaView style={shared.container} testID="home-screen">
      {/* Summary card with hero metric and supporting stats */}
      <SummaryCard
        profileUrl={profileUrl}
        onProfilePress={navigateToSettings}
        heroValue={heroValue}
        heroLabel={heroLabel}
        heroColor={heroColor}
        heroZoneLabel={heroZoneLabel}
        heroZoneColor={heroZoneColor}
        heroTrend={heroTrend}
        onHeroPress={navigateToHeroMetric}
        sparklineData={sparklineData}
        showSparkline={showSparkline}
        supportingMetrics={supportingMetrics}
      />

      {/* Search and Filter bar - outside FlatList to preserve focus */}
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
            // iOS-specific keyboard optimizations
            keyboardAppearance={isDark ? 'dark' : 'light'}
            enablesReturnKeyAutomatically={Platform.OS === 'ios'}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              accessibilityLabel={t('common.clearSearch')}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="close-circle" size={18} color={themeColors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          testID="home-filter-button"
          style={[
            styles.filterButton,
            isDark && styles.filterButtonDark,
            (showFilters || selectedTypeGroup) && styles.filterButtonActive,
          ]}
          onPress={toggleFilters}
          accessibilityLabel={showFilters ? t('filters.hideFilters') : t('filters.showFilters')}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="filter-variant"
            size={20}
            color={showFilters || selectedTypeGroup ? colors.textOnDark : themeColors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Filter chips - outside FlatList */}
      {showFilters && (
        <View style={styles.filterChips}>
          {Object.keys(ACTIVITY_TYPE_GROUPS).map((group) => (
            <TouchableOpacity
              key={group}
              style={[
                styles.filterChip,
                isDark && styles.filterChipDark,
                selectedTypeGroup === group && styles.filterChipActive,
              ]}
              onPress={() => selectTypeGroup(group)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  isDark && styles.filterChipTextDark,
                  selectedTypeGroup === group && styles.filterChipTextActive,
                ]}
              >
                {group}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        testID="home-activity-list"
        data={filteredActivities}
        renderItem={renderActivity}
        extraData={terrainSnapshotVersion}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={isError ? renderError : renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={isOnline ? handleRefresh : undefined}
            enabled={isOnline}
            colors={[colors.primary]}
            tintColor={colors.primary}
            progressBackgroundColor={isDark ? darkColors.surface : colors.surface}
            title={Platform.OS === 'ios' ? t('common.pullToRefresh') : undefined}
            titleColor={Platform.OS === 'ios' ? themeColors.textSecondary : undefined}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
        // iOS scroll performance optimizations
        removeClippedSubviews={Platform.OS === 'ios'}
        maxToRenderPerBatch={Platform.OS === 'ios' ? 15 : 10}
        windowSize={Platform.OS === 'ios' ? 21 : 11}
        initialNumToRender={10}
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />

      {/* Hidden WebView for generating 3D terrain snapshots */}
      {isAnyTerrain3DEnabled && (
        <TerrainSnapshotWebView ref={snapshotRef} onSnapshotComplete={handleSnapshotComplete} />
      )}
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Summary card skeleton styles
  summaryCardSkeleton: {
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  summaryCardSkeletonDark: {
    backgroundColor: darkColors.surface,
    ...shadows.none,
    borderWidth: 1,
    borderColor: darkColors.border,
  },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  skeletonCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.divider,
  },
  skeletonSpacer: {
    flex: 1,
  },
  skeletonHero: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  skeletonHeroValue: {
    width: 60,
    height: 32,
    borderRadius: 4,
    backgroundColor: colors.divider,
    marginBottom: spacing.xs,
  },
  skeletonHeroLabel: {
    width: 40,
    height: 14,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  skeletonMetrics: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.lg,
  },
  skeletonMetric: {
    width: 50,
    height: 14,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  skeletonElementDark: {
    backgroundColor: darkColors.border,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: opacity.overlay.light,
    borderRadius: 10,
    paddingHorizontal: layout.cardMargin,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchBarDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchInputDark: {
    color: colors.textOnDark,
  },
  filterButton: {
    width: 44, // Accessibility minimum
    height: 44, // Accessibility minimum
    borderRadius: 10,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: spacing.md,
    backgroundColor: opacity.overlay.light,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  filterChipTextDark: {
    color: darkColors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.textOnDark,
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  skeletonContainer: {
    flex: 1,
    paddingHorizontal: layout.screenPadding,
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
    color: colors.error,
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: 8,
  },
  footerText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
});
