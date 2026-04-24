/**
 * Routes list component.
 * Main list showing all route groups.
 *
 * Uses lightweight GroupSummary for list display (no activity IDs array).
 * Full group data is only loaded on detail page.
 */

import React, { useCallback, useEffect, useRef, memo, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  LayoutAnimation,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useTheme, useRouteProcessing, useCacheDays } from '@/hooks';
import type { GroupWithPolyline } from 'veloqrs';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';
import { UI } from '@/lib/utils/constants';
import { computeCenter, haversineDistance, type LatLng } from '@/lib/geo/distance';
import { RouteRow } from './RouteRow';
import { DataRangeFooter } from './DataRangeFooter';
import type { DiscoveredRouteInfo, RouteGroup } from '@/types';
import { toActivityType } from '@/types/routes';

export type RoutesSortOption = 'activities' | 'distance' | 'name' | 'nearby';

interface RoutesListProps {
  /** Callback when list is pulled to refresh */
  onRefresh?: () => void;
  /** Whether refresh is in progress */
  isRefreshing?: boolean;
  /** Filter by start date (only show routes with activities after this date) */
  startDate?: Date;
  /** Filter by end date (only show routes with activities before this date) */
  endDate?: Date;
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
}

// Memoized routes list - only updates when route count changes
const DiscoveredRoutesList = memo(
  function DiscoveredRoutesList({
    routes,
    isDark,
    t,
  }: {
    routes: DiscoveredRouteInfo[];
    isDark: boolean;
    t: (key: string) => string;
  }) {
    const prevCountRef = useRef(routes.length);

    // Animate layout when routes are added
    useEffect(() => {
      if (routes.length > prevCountRef.current) {
        LayoutAnimation.configureNext({
          duration: 200,
          create: {
            type: LayoutAnimation.Types.easeOut,
            property: LayoutAnimation.Properties.opacity,
          },
          update: { type: LayoutAnimation.Types.easeOut },
        });
      }
      prevCountRef.current = routes.length;
    }, [routes.length]);

    if (routes.length === 0) {
      return (
        <View style={styles.noRoutesYet}>
          <MaterialCommunityIcons
            name="map-search-outline"
            size={32}
            color={isDark ? darkColors.iconDisabled : colors.gray400}
          />
          <Text style={[styles.noRoutesText, isDark && styles.textMuted]}>
            {t('routes.lookingForRoutes')}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.routesList}>
        {routes.map((route) => (
          <RouteRow key={route.id} route={route} />
        ))}
      </View>
    );
  },
  (prev, next) => {
    // Only re-render if route count changes or activity counts change
    if (prev.routes.length !== next.routes.length) return false;
    if (prev.isDark !== next.isDark) return false;
    // Check if any route's activity count changed
    for (let i = 0; i < prev.routes.length; i++) {
      if (prev.routes[i].activityCount !== next.routes[i].activityCount) return false;
    }
    return true;
  }
);

/**
 * Convert batch GroupWithPolyline to RouteGroup with pre-loaded consensus points.
 * Avoids per-row useConsensusRoute FFI calls.
 */
function batchGroupToRouteGroup(group: GroupWithPolyline, index: number): RouteGroup {
  const sportType = group.sportType || 'Ride';
  // Convert flat coords [lat1, lng1, lat2, lng2, ...] to RoutePoint[]
  const consensusPoints: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < group.consensusPolyline.length - 1; i += 2) {
    consensusPoints.push({
      lat: group.consensusPolyline[i],
      lng: group.consensusPolyline[i + 1],
    });
  }
  const center = group.bounds
    ? computeCenter({
        minLat: group.bounds.minLat,
        maxLat: group.bounds.maxLat,
        minLng: group.bounds.minLng,
        maxLng: group.bounds.maxLng,
      })
    : undefined;
  return {
    id: group.groupId,
    name: group.customName || `${sportType} Route ${index + 1}`,
    type: toActivityType(sportType),
    activityCount: group.activityCount,
    activityIds: [],
    signature: null,
    consensusPoints,
    distance: group.distanceMeters > 0 ? group.distanceMeters : undefined,
    sportTypes: group.sportTypes ?? [sportType],
    center,
  };
}

export const RoutesList = memo(function RoutesList({
  onRefresh,
  isRefreshing = false,
  startDate,
  endDate,
  batchGroups,
  onLoadMore,
  hasMore = false,
  userLocation,
  totalGroupCount,
  sortOption,
  onSortChange,
}: RoutesListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

  // Convert batch groups to RouteGroup format for RouteRow
  const allGroups = useMemo(() => {
    return batchGroups.map((g, i) => batchGroupToRouteGroup(g, i));
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

  // Memoize routes array reference to prevent unnecessary re-renders
  const routes = useMemo(() => {
    return [] as DiscoveredRouteInfo[];
  }, []);

  const sortChips: { key: RoutesSortOption; label: string; icon: string }[] = useMemo(
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
  const routeInfoText = 'Routes are whole activities you repeat on similar paths.';

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
          <DiscoveredRoutesList
            routes={routes}
            isDark={isDark}
            t={((key: string) => t(key as never) as string) as (key: string) => string}
          />
        </View>
      )}
    </View>
  );

  const renderEmpty = () => {
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
      {/* Search and sport filters — outside FlatList to prevent keyboard dismissal */}
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
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
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
                    style={[
                      styles.sortChip,
                      isDark && styles.sortChipDark,
                      isActive && styles.sortChipActive,
                    ]}
                    onPress={() => onSortChange(chip.key)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name={chip.icon as any}
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
    fontSize: 12,
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
    marginTop: 2,
  },
  summaryText: {
    fontSize: 13,
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
    borderRadius: 10,
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
    fontSize: 14,
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
    marginTop: 2,
  },
  sportFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sportFilterChipDark: {
    borderColor: darkColors.border,
  },
  sportFilterLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  sortChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 14,
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
    fontSize: 12,
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
    fontSize: 17,
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
    borderRadius: 6,
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
});
