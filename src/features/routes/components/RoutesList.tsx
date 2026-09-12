/**
 * Routes list component.
 * Main list showing all route groups.
 *
 * Uses lightweight GroupSummary for list display (no activity IDs array).
 * Full group data is only loaded on detail page.
 */

import React, { memo, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useRouteProcessing } from '@/features/routes/hooks/useRouteProcessing';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import type { GroupWithPolyline } from 'veloqrs';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';
import { UI } from '@/shared/app/constants';
import { haversineDistance, type LatLng } from '@/shared/geo/distance';
import { Shimmer } from '@/shared/ui';
import { RouteRow } from './RouteRow';
import { DataRangeFooter } from './DataRangeFooter';
import type { RouteGroup } from '@/types';
import { batchGroupToRouteGroup } from '@/features/routes/lib/batchGroupToRouteGroup';

export type RoutesSortOption = 'activities' | 'distance' | 'name' | 'nearby';

interface RoutesListProps {
  /** Callback when list is pulled to refresh */
  onRefresh?: () => void;
  /** Whether refresh is in progress */
  isRefreshing?: boolean;
  /** Pre-loaded groups with consensus polylines from batch FFI call */
  batchGroups: GroupWithPolyline[];
  /** Callback to load more groups (pagination) */
  onLoadMore?: () => void;
  /** Whether more groups are available to load */
  hasMore?: boolean;
  /** User's current location for "Nearby" sort */
  userLocation?: LatLng | null;
  /** Total routes count for the header summary */
  totalGroupCount?: number;
  /** Active sort option */
  sortOption: RoutesSortOption;
  /** Called when sort changes */
  onSortChange: (next: RoutesSortOption) => void;
  /** Engine data still loading - show skeletons instead of an empty state */
  isLoading?: boolean;
}

function RouteRowSkeleton() {
  return (
    <View style={styles.skeletonRow}>
      <Shimmer width={50} height={36} borderRadius={layout.borderRadiusSm} />
      <View style={styles.skeletonText}>
        <Shimmer width="60%" height={14} borderRadius={layout.borderRadiusXs} />
        <Shimmer width="40%" height={12} borderRadius={layout.borderRadiusXs} />
      </View>
    </View>
  );
}

export const RoutesList = memo(function RoutesList({
  onRefresh,
  isRefreshing = false,
  batchGroups,
  onLoadMore,
  hasMore = false,
  userLocation,
  totalGroupCount,
  sortOption,
  onSortChange,
  isLoading = false,
}: RoutesListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

  // Convert batch groups to RouteGroup format for RouteRow
  const allGroups = useMemo(() => {
    return batchGroups.map(batchGroupToRouteGroup);
  }, [batchGroups]);

  // Filter groups by search query, then sort
  const groups = useMemo(() => {
    let filtered = [...allGroups];
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((g) => g.name?.toLowerCase().includes(query));
    }
    // Apply sort
    if (sortOption === 'activities') {
      filtered.sort((a, b) => b.activityCount - a.activityCount);
    } else if (sortOption === 'distance') {
      filtered.sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0));
    } else if (sortOption === 'name') {
      filtered.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    }

    // Preserve native order for nearby sorting so pagination stays correct.
    return filtered;
  }, [allGroups, searchQuery, sortOption]); // userLocation excluded: nearby sorting is Rust-side

  // Pre-compute distance from user for each route (used for display on every row)
  const distanceMap = useMemo(() => {
    if (!userLocation) return null;
    const map = new Map<string, number>();
    for (const g of groups) {
      if (g.center) {
        map.set(g.id, haversineDistance(userLocation, g.center));
      }
    }
    return map;
  }, [groups, userLocation]);

  // Calculate processed count
  const processedCount = useMemo(
    () => allGroups.reduce((sum, g) => sum + g.activityCount, 0),
    [allGroups]
  );

  const isReady = true; // Summaries are always ready (query on demand)

  const { progress } = useRouteProcessing();

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();

  // Note: useFocusEffect refresh removed - useGroupSummaries subscribes to engine events
  // and automatically refreshes when data changes (e.g., after renaming on detail page)

  const showProcessing = progress.status === 'processing';

  const showActivityList = progress.status === 'processing';

  const sortChips: {
    key: RoutesSortOption;
    label: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
  }[] = useMemo(
    () => [
      { key: 'nearby', label: t('routes.sortNearby' as never) as string, icon: 'crosshairs-gps' },
      {
        key: 'activities',
        label: t('routes.sortActivities' as never) as string,
        icon: 'sort-numeric-descending',
      },
      {
        key: 'distance',
        label: t('routes.sortDistance' as never) as string,
        icon: 'map-marker-distance',
      },
      {
        key: 'name',
        label: t('routes.sortNameAZ' as never) as string,
        icon: 'sort-alphabetical-ascending',
      },
    ],
    [t]
  );

  const displayRouteCount = totalGroupCount ?? allGroups.length;

  const renderHeader = () => (
    <View>
      {/* Discovered routes during processing */}
      {showActivityList && (
        <View style={styles.discoveredSection}>
          <View style={[styles.currentActivity, isDark && styles.currentActivityDark]}>
            <MaterialCommunityIcons name="magnify" size={14} color={colors.primary} />
            <Text
              style={[styles.currentActivityText, isDark && styles.textMuted]}
              numberOfLines={1}
            >
              {progress.message
                ? (t('routes.checking' as never, { name: progress.message }) as string)
                : (t('routes.waiting' as never) as string)}
            </Text>
          </View>
          <View style={styles.noRoutesYet}>
            <MaterialCommunityIcons
              name="map-search-outline"
              size={32}
              color={isDark ? darkColors.iconDisabled : colors.gray400}
            />
            <Text style={[styles.noRoutesText, isDark && styles.textMuted]}>
              {t('routes.lookingForRoutes' as never) as string}
            </Text>
          </View>
        </View>
      )}
    </View>
  );

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RouteRowSkeleton key={i} />
          ))}
        </View>
      );
    }

    if (!isReady) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="loading"
            size={48}
            color={isDark ? darkColors.iconDisabled : colors.gray400}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            {t('routes.loadingRoutes')}
          </Text>
        </View>
      );
    }

    if (showProcessing) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="map-search-outline"
            size={48}
            color={isDark ? darkColors.iconDisabled : colors.gray400}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            {t('routes.analysingRoutes')}
          </Text>
          <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
            {t('routes.thisMayTakeMoment')}
          </Text>
        </View>
      );
    }

    if (processedCount === 0) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="map-marker-path"
            size={48}
            color={isDark ? darkColors.iconDisabled : colors.gray400}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            {t('routes.noRoutesYet')}
          </Text>
          <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
            {t('routes.routesWillAppear')}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="map-marker-question-outline"
          size={48}
          color={isDark ? darkColors.iconDisabled : colors.gray400}
        />
        <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
          {t('routes.noMatchingRoutes')}
        </Text>
        <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
          {t('routes.routesWithTwoPlus')}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (groups.length === 0) return null;
    return (
      <View>
        {hasMore && (
          <View style={styles.loadingMore}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
        <DataRangeFooter days={cacheDays} isDark={isDark} />
      </View>
    );
  };

  return (
    <View style={styles.outerContainer}>
      {/* Search and sport filters - outside FlatList to prevent keyboard dismissal */}
      {!showProcessing && allGroups.length > 0 && (
        <View style={styles.filterHeader}>
          <View style={[styles.searchContainer, isDark && styles.searchContainerDark]}>
            <MaterialCommunityIcons
              name="magnify"
              size={18}
              color={isDark ? darkColors.textDisabled : colors.textDisabled}
            />
            <TextInput
              style={[styles.searchInput, isDark && styles.searchInputDark]}
              placeholder={t('routes.searchRoutes' as never) as string}
              placeholderTextColor={isDark ? darkColors.textDisabled : colors.textDisabled}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('common.clearSearch')}
              >
                <MaterialCommunityIcons
                  name="close-circle"
                  size={16}
                  color={isDark ? darkColors.textDisabled : colors.textDisabled}
                />
              </TouchableOpacity>
            )}
          </View>
          {/* Count line */}
          <View style={styles.countRow}>
            <Text style={[styles.summaryText, isDark && styles.summaryTextDark]}>
              {displayRouteCount} {t('trainingScreen.routes')}
            </Text>
          </View>
          {/* Sort chips */}
          <View style={styles.sortChipRow}>
            {groups.length > 1 &&
              sortChips.map((chip) => {
                const isActive = sortOption === chip.key;
                return (
                  <TouchableOpacity
                    key={chip.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={chip.label}
                    style={[
                      styles.sortChip,
                      isDark && styles.sortChipDark,
                      isActive && styles.sortChipActive,
                    ]}
                    onPress={() => onSortChange(chip.key)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name={chip.icon}
                      size={13}
                      color={
                        isActive
                          ? colors.primary
                          : isDark
                            ? darkColors.textSecondary
                            : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.sortChipLabel,
                        isDark && styles.textMuted,
                        isActive && styles.sortChipLabelActive,
                      ]}
                    >
                      {chip.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
          </View>
        </View>
      )}
      <FlatList
        testID="routes-list"
        data={groups}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <View testID={`route-row-${index}`}>
            <RouteRow
              route={item as unknown as RouteGroup}
              navigable
              distanceFromUser={distanceMap?.get(item.id)}
            />
          </View>
        )}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={groups.length === 0 ? styles.emptyList : styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.5}
        // Performance optimizations
        removeClippedSubviews={Platform.OS === 'ios'}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={8}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          ) : undefined
        }
      />
    </View>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
  },
  filterHeader: {
    marginBottom: 0,
  },
  infoNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
  },
  infoNoticeDark: {},
  infoText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    color: colors.textDisabled,
    lineHeight: 16,
  },
  infoTextDark: {
    color: darkColors.textDisabled,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginTop: spacing.xxs,
  },
  summaryText: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  summaryTextDark: {
    color: darkColors.textPrimary,
  },
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray100,
    borderRadius: layout.borderRadiusMd,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 4 : 2,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  searchContainerDark: {
    backgroundColor: darkColors.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchInputDark: {
    color: darkColors.textPrimary,
  },
  sportFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xxs,
  },
  sportFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sportFilterChipDark: {
    borderColor: darkColors.border,
  },
  sportFilterLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  sortChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xxs,
    marginBottom: spacing.md,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipDark: {
    borderColor: darkColors.border,
  },
  sortChipActive: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary,
  },
  sortChipLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  sortChipLabelActive: {
    color: colors.primary,
  },
  emptyList: {
    flexGrow: 1,
    paddingTop: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding * 2,
    paddingVertical: spacing.xxl * 2,
  },
  emptyTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: typography.bodySmall.lineHeight,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  discoveredSection: {
    marginBottom: spacing.md,
  },
  currentActivity: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: opacity.overlay.subtle,
    borderRadius: spacing.xsPlus,
    marginBottom: spacing.sm,
    gap: spacing.xs,
    height: 32, // Fixed height to prevent jumps
  },
  currentActivityDark: {
    backgroundColor: opacity.overlayDark.subtle,
  },
  currentActivityText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  routesList: {
    maxHeight: UI.ROUTES_LIST_MAX_HEIGHT,
  },
  noRoutesYet: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginHorizontal: spacing.md,
  },
  noRoutesText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  loadingMore: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  skeletonList: {
    paddingTop: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  skeletonText: {
    flex: 1,
    gap: spacing.xs,
  },
});
