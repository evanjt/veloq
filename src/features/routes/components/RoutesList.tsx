/**
 * Routes list component.
 * Main list showing all route groups.
 *
 * Uses lightweight GroupSummary for list display (no activity IDs array).
 * Full group data is only loaded on detail page.
 */

import { listCountLabel, ROUTE_COUNT_KEYS } from '@/features/routes/lib/listCountLabel';
import React, { memo, useMemo, useRef } from 'react';
import { View, StyleSheet, FlatList, Pressable } from 'react-native';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import type { FfiCatalogueEmptyReason, GroupWithPolyline } from 'veloqrs';
import { Text } from 'react-native-paper';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  colorWithOpacity,
  opacity,
  colors,
  darkColors,
  iconSize,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
  stroke,
  themePalette,
} from '@/theme';
import { haversineDistance, type LatLngShort } from '@/shared/geo/distance';
import { filterSummary } from '@/shared/format/filterSummary';
import {
  EmptyState,
  ErrorState,
  ExplanationCard,
  pressable,
  pressRipple,
  SearchBar,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useScrollToTopOnReselect } from '@/shared/ui/tabReselect';
import { RowSkeleton } from '@/features/routes/components/RowSkeleton';
import { RouteRow } from './RouteRow';
import { CatalogueEmptyState } from './CatalogueEmptyState';
import { DataRangeFooter } from './DataRangeFooter';
import { routesExplanation } from '@/features/routes/lib/explanationCopy';
import { SportFilterChips } from './SportFilterChips';
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
  /** The sports the athlete has activities in, offered as the sport chips */
  sportOptions?: string[] | undefined;
  /** The sport the list is narrowed to, if any */
  sportType?: string | undefined;
  /** Called with the sport chosen, or undefined for all sports */
  onSportChange?: (next: string | undefined) => void;
  /** Clears the search and the sport together, from a list they have emptied */
  onClearFilters?: (() => void) | undefined;
  /** Engine data still loading - show skeletons instead of an empty state */
  isLoading?: boolean;
  /** The page read failed: shown with a retry, never as skeletons or an empty library */
  loadError?: unknown;
  /** Reads the page again after a failure */
  onRetry?: (() => void) | undefined;
  /** Why the engine holds no route at all, or null while it holds one */
  emptyReason?: FfiCatalogueEmptyReason | null | undefined;
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
  emptyReason = null,
  searchQuery,
  onSearchChange,
  sportOptions = [],
  sportType,
  onSportChange,
  onClearFilters,
}: RoutesListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const listRef = useRef<FlatList<RouteGroup>>(null);
  useScrollToTopOnReselect('/insights', listRef);

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
  const filtered = searchQuery.trim().length > 0 || sportType !== undefined;
  const routeCountLabel = listCountLabel(
    t,
    ROUTE_COUNT_KEYS,
    shownGroupCount ?? routeTotal,
    routeTotal
  );

  const renderEmpty = () => {
    if (loadError && onRetry) {
      return <ErrorState error={loadError} onRetry={onRetry} testID="routes-load-failure" />;
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

    if (emptyReason) {
      return <CatalogueEmptyState reason={emptyReason} kind="routes" />;
    }

    if (filtered) {
      return (
        <EmptyState
          icon="filter-remove-outline"
          title={t('routes.noRoutesFor', {
            filters: filterSummary(
              t,
              searchQuery,
              sportType === undefined ? [] : [t(`activityTypes.${sportType}` as never, sportType)]
            ),
          })}
          actionLabel={t('common.clearFilters')}
          onAction={onClearFilters}
          actionTestID="routes-clear-filters"
        />
      );
    }

    return (
      <EmptyState
        icon="map-marker-question-outline"
        title={t('routes.noMatchingRoutes')}
        description={t('routes.routesWithTwoPlus')}
      />
    );
  };

  const renderFooter = () => {
    if (groups.length === 0) return null;
    return (
      <View>
        {hasMore ? <RowSkeleton /> : null}
        <DataRangeFooter days={cacheDays} isDark={isDark} />
        <View style={styles.explanation}>
          <ExplanationCard {...routesExplanation(t)} testID="routes-explanation" />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.outerContainer}>
      {/* Search and sport filters - outside FlatList to prevent keyboard dismissal */}
      {((routeTotal > 0 && !emptyReason) || searchQuery.length > 0 || sportType !== undefined) && (
        <View style={styles.filterHeader}>
          <SearchBar
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder={t('routes.searchRoutes' as never) as string}
            style={styles.searchBar}
          />
          {onSportChange && (sportOptions.length > 1 || sportType !== undefined) ? (
            <SportFilterChips
              options={sportOptions}
              selectedType={sportType}
              onSelect={onSportChange}
            />
          ) : null}
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
                  <Pressable
                    key={chip.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={chip.label}
                    style={pressable([
                      styles.sortChip,
                      isDark && styles.sortChipDark,
                      isActive && {
                        backgroundColor: colorWithOpacity(palette.actionPrimary, opacity.tint1),
                        borderColor: palette.actionPrimary,
                      },
                    ])}
                    android_ripple={pressRipple}
                    hitSlop={sortChipHitSlop}
                    onPress={() => onSortChange(chip.key)}
                  >
                    <Icon
                      name={chip.icon}
                      size={iconSize.xs}
                      color={
                        isActive
                          ? palette.actionPrimary
                          : isDark
                            ? darkColors.textSecondary
                            : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.sortChipLabel,
                        isDark && styles.textSecondary,
                        isActive && styles.sortChipLabelActive,
                        isActive && isDark && { color: darkColors.actionLink },
                      ]}
                    >
                      {chip.label}
                    </Text>
                  </Pressable>
                );
              })}
          </View>
        </View>
      )}
      <FlatList
        ref={listRef}
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
        // Performance optimisations
        removeClippedSubviews
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={8}
        refreshControl={
          onRefresh ? (
            <ScreenRefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          ) : undefined
        }
      />
    </View>
  );
});

const SORT_CHIP_HEIGHT = typography.caption.lineHeight + 2 * (spacing.xs + stroke.one);
const sortChipHitSlop = slopToMinTapTarget(SORT_CHIP_HEIGHT);

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
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  summaryTextDark: {
    color: darkColors.textPrimary,
  },
  explanation: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
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
    minHeight: SORT_CHIP_HEIGHT,
    borderRadius: layout.borderRadius,
    borderWidth: stroke.one,
    borderColor: colors.border,
  },
  sortChipDark: {
    borderColor: darkColors.border,
  },
  sortChipLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sortChipLabelActive: {
    color: colors.actionLink,
  },
  emptyList: {
    flexGrow: 1,
    paddingTop: spacing.md,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  skeletonList: {
    paddingTop: spacing.md,
  },
});
