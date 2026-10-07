/**
 * Routes list component.
 * Main list showing all route groups.
 *
 * Uses lightweight GroupSummary for list display (no activity IDs array).
 * Full group data is only loaded on detail page.
 */

import { listCountLabel } from '@/features/routes/lib/listCountLabel';
import React, { memo, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import type { GroupWithPolyline } from 'veloqrs';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { haversineDistance, type LatLngShort } from '@/shared/geo/distance';
import { EmptyState, SearchBar } from '@/shared/ui';
import { RowSkeleton } from '@/features/routes/components/RowSkeleton';
import { RouteRow } from './RouteRow';
import { DataRangeFooter } from './DataRangeFooter';
import { SportFilterMenu } from './SportFilterMenu';
import type { RouteGroup } from '@/types';
import { batchGroupToRouteGroup } from '@/features/routes/lib/batchGroupToRouteGroup';
import type { RoutesSortOption } from '@/features/routes/lib/routesScreenQuery';

export type { RoutesSortOption };

interface RoutesListProps {
  /** Callback when list is pulled to refresh */
  onRefresh?: () => void;
  /** Whether refresh is in progress */
  isRefreshing?: boolean;
  /** Pre-loaded groups with representative polylines from batch FFI call */
  batchGroups: GroupWithPolyline[];
  /** Callback to load more groups (pagination) */
  onLoadMore?: () => void;
  /** Whether more groups are available to load */
  hasMore?: boolean;
  /** User's current location for "Nearby" sort */
  userLocation?: LatLngShort | null;
  /** Total routes count for the header summary */
  totalGroupCount?: number;
  /** Routes the search leaves, for the header beside the list. */
  shownGroupCount?: number;
  /** Active sort option */
  sortOption: RoutesSortOption;
  /** Called when sort changes */
  onSortChange: (next: RoutesSortOption) => void;
  /** The search term the engine filtered on */
  searchQuery: string;
  /** Called when the search term changes */
  onSearchChange: (next: string) => void;
  /** The sports the athlete has activities in, offered in the sport filter menu */
  sportOptions?: string[] | undefined;
  /** The sport the list is narrowed to, if any */
  sportType?: string | undefined;
  /** Called with the sport chosen, or undefined for all sports */
  onSportChange?: (next: string | undefined) => void;
  /** Engine data still loading - show skeletons instead of an empty state */
  isLoading?: boolean;
  /** The page read failed: shown with a retry, never as skeletons or an empty library */
  loadError?: Error | null | undefined;
  /** Reads the page again after a failure */
  onRetry?: (() => void) | undefined;
}

export const RoutesList = memo(function RoutesList({
  onRefresh,
  isRefreshing = false,
  batchGroups,
  onLoadMore,
  hasMore = false,
  userLocation,
  totalGroupCount,
  shownGroupCount,
  sortOption,
  onSortChange,
  isLoading = false,
  loadError,
  onRetry,
  searchQuery,
  onSearchChange,
  sportOptions = [],
  sportType,
  onSportChange,
}: RoutesListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  // The engine searched and ordered the catalogue before it paged it, so the
  // rows arrive ready to render. Searching or sorting again here would read one
  // page and call it the library.
  const allGroups = useMemo(() => {
    return batchGroups.map(batchGroupToRouteGroup);
  }, [batchGroups]);
  const groups = allGroups;

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

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();

  // Note: useFocusEffect refresh removed - useGroupSummaries subscribes to engine events
  // and automatically refreshes when data changes (e.g., after renaming on detail page)

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

  const routeTotal = totalGroupCount ?? allGroups.length;
  const routeCountLabel = listCountLabel(
    t,
    t('trainingScreen.routes'),
    shownGroupCount ?? routeTotal,
    routeTotal
  );

  const renderEmpty = () => {
    if (loadError) {
      return (
        <EmptyState
          icon="alert-circle-outline"
          title={t('emptyState.error.title')}
          description={t('emptyState.error.description')}
          actionLabel={t('common.retry')}
          onAction={onRetry}
        />
      );
    }

    if (isLoading) {
      return (
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      );
    }

    if (routeTotal === 0) {
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
      {(routeTotal > 0 || searchQuery.length > 0 || sportType !== undefined) && (
        <View style={styles.filterHeader}>
          <SearchBar
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder={t('routes.searchRoutes' as never) as string}
            style={styles.searchBar}
          />
          {onSportChange && (sportOptions.length > 1 || sportType !== undefined) && (
            <SportFilterMenu
              options={sportOptions.map((type) => ({ type }))}
              selectedType={sportType}
              onSelect={onSportChange}
            />
          )}
          {/* Count line */}
          <View style={styles.countRow}>
            <Text style={[styles.summaryText, isDark && styles.summaryTextDark]}>
              {routeCountLabel}
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
                        isActive && isDark && { color: darkColors.linkTeal },
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
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={groups.length === 0 ? styles.emptyList : styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.5}
        // Performance optimizations
        removeClippedSubviews
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

const LIST_EMPTY_VERTICAL_PADDING = spacing.xxl * 2;

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
  },
  filterHeader: {
    marginBottom: 0,
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
  searchBar: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
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
    color: colors.linkTeal,
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
    paddingVertical: LIST_EMPTY_VERTICAL_PADDING,
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
  loadingMore: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  skeletonList: {
    paddingTop: spacing.md,
  },
});
