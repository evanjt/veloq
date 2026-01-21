/**
 * Routes list component.
 * Main list showing all route groups.
 *
 * Uses lightweight GroupSummary for list display (no activity IDs array).
 * Full group data is only loaded on detail page.
 */

import React, { useEffect, useRef, memo, useMemo } from 'react';
import { useSyncDateRange } from '@/providers/SyncDateRangeStore';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  LayoutAnimation,
  Platform,
} from 'react-native';
import { useTheme, useGroupSummaries, useRouteProcessing } from '@/hooks';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';
import { UI } from '@/lib/utils/constants';
import { CacheScopeNotice } from './CacheScopeNotice';
import { RouteRow } from './RouteRow';
import { DataRangeFooter } from './DataRangeFooter';
import type { DiscoveredRouteInfo, RouteGroup } from '@/types';
import { toActivityType } from '@/types/routes';
import type { GroupSummary } from 'route-matcher-native';

interface RoutesListProps {
  /** Callback when list is pulled to refresh */
  onRefresh?: () => void;
  /** Whether refresh is in progress */
  isRefreshing?: boolean;
  /** Filter by start date (only show routes with activities after this date) */
  startDate?: Date;
  /** Filter by end date (only show routes with activities before this date) */
  endDate?: Date;
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
 * Convert GroupSummary to RouteGroup-like object for RouteRow.
 * Uses empty activityIds since RouteRow with navigable=true doesn't need them.
 */
function summaryToRouteGroup(summary: GroupSummary, index: number): RouteGroup {
  const sportType = summary.sportType || 'Ride';
  return {
    id: summary.groupId,
    name: summary.customName || `${sportType} Route ${index + 1}`,
    type: toActivityType(sportType),
    activityCount: summary.activityCount,
    activityIds: [], // Not needed for navigable rows (empty array to satisfy type)
    signature: null, // Loaded lazily via useConsensusRoute in RouteRow
  };
}

export function RoutesList({
  onRefresh,
  isRefreshing = false,
  startDate,
  endDate,
}: RoutesListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  // Use lightweight summaries - no activity IDs loaded, just counts and metadata
  // This prevents memory bloat when many activities are cached
  const { count: totalCount, summaries } = useGroupSummaries({
    minActivities: 2,
    sortBy: 'count',
  });

  // Convert summaries to RouteGroup format for RouteRow
  const groups = useMemo(() => summaries.map((s, i) => summaryToRouteGroup(s, i)), [summaries]);

  // Calculate processed count from summaries
  const processedCount = useMemo(
    () => summaries.reduce((sum, s) => sum + s.activityCount, 0),
    [summaries]
  );

  const isReady = true; // Summaries are always ready (query on demand)

  const { progress } = useRouteProcessing();

  // Get cached date range for footer
  const oldest = useSyncDateRange((s) => s.oldest);
  const newest = useSyncDateRange((s) => s.newest);
  const cacheDays = useMemo(() => {
    if (!oldest || !newest) return 90; // default
    return Math.ceil(
      (new Date(newest).getTime() - new Date(oldest).getTime()) / (1000 * 60 * 60 * 24)
    );
  }, [oldest, newest]);

  // Note: useFocusEffect refresh removed - useGroupSummaries subscribes to engine events
  // and automatically refreshes when data changes (e.g., after renaming on detail page)

  const showProcessing = progress.status === 'processing';

  const showActivityList = progress.status === 'processing';

  // Memoize routes array reference to prevent unnecessary re-renders
  const routes = useMemo(() => {
    return [] as DiscoveredRouteInfo[];
  }, []);

  const renderHeader = () => (
    <View>
      {/* Discovered routes during processing - show current activity being checked */}
      {showActivityList && (
        <View style={styles.discoveredSection}>
          {/* Current activity - fixed height to prevent jumps */}
          <View style={[styles.currentActivity, isDark && styles.currentActivityDark]}>
            <MaterialCommunityIcons name="magnify" size={14} color={colors.primary} />
            <Text
              style={[styles.currentActivityText, isDark && styles.textMuted]}
              numberOfLines={1}
            >
              {progress.message
                ? (t('routes.checking' as never, {
                    name: progress.message,
                  }) as string)
                : (t('routes.waiting' as never) as string)}
            </Text>
          </View>

          {/* Discovered routes list */}
          <DiscoveredRoutesList
            routes={routes}
            isDark={isDark}
            t={((key: string) => t(key as never) as string) as (key: string) => string}
          />
        </View>
      )}

      {/* Cache scope notice - show when idle */}
      {!showProcessing && isReady && processedCount > 0 && (
        <CacheScopeNotice
          processedCount={processedCount}
          groupCount={groups.length} // Only show groups with 2+ activities (actual routes)
        />
      )}

      {/* Timeline info notice - show when idle and no processing */}
      {!showProcessing && isReady && (
        <View style={[styles.infoNotice, isDark && styles.infoNoticeDark]}>
          <MaterialCommunityIcons
            name="timeline-clock-outline"
            size={14}
            color={isDark ? darkColors.textDisabled : colors.textDisabled}
          />
          <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
            {t('routes.expandTimeline')}
          </Text>
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
    return <DataRangeFooter days={cacheDays} isDark={isDark} />;
  };

  return (
    <FlatList
      data={groups}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <RouteRow route={item as unknown as RouteGroup} navigable />}
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={renderEmpty}
      ListFooterComponent={renderFooter}
      contentContainerStyle={groups.length === 0 ? styles.emptyList : styles.list}
      showsVerticalScrollIndicator={false}
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
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
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
  infoNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  infoNoticeDark: {},
  infoText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    color: colors.textDisabled,
    lineHeight: typography.caption.lineHeight,
  },
  infoTextDark: {
    color: darkColors.textSecondary,
  },
});
