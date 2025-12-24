/**
 * Routes list component.
 * Main list showing all route groups.
 */

import React, { useEffect, useRef, memo, useMemo } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, useColorScheme, LayoutAnimation, Platform, UIManager } from 'react-native';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { useRouteGroups, useRouteProcessing } from '@/hooks';
import { CacheScopeNotice } from './CacheScopeNotice';
import { RouteRow } from './RouteRow';
import type { DiscoveredRouteInfo } from '@/types';

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
const DiscoveredRoutesList = memo(function DiscoveredRoutesList({
  routes,
  isDark,
}: {
  routes: DiscoveredRouteInfo[];
  isDark: boolean;
}) {
  const prevCountRef = useRef(routes.length);

  // Animate layout when routes are added
  useEffect(() => {
    if (routes.length > prevCountRef.current) {
      LayoutAnimation.configureNext({
        duration: 200,
        create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
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
          color={isDark ? '#444' : '#CCC'}
        />
        <Text style={[styles.noRoutesText, isDark && styles.textMuted]}>
          Looking for matching routes...
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
}, (prev, next) => {
  // Only re-render if route count changes or activity counts change
  if (prev.routes.length !== next.routes.length) return false;
  if (prev.isDark !== next.isDark) return false;
  // Check if any route's activity count changed
  for (let i = 0; i < prev.routes.length; i++) {
    if (prev.routes[i].activityCount !== next.routes[i].activityCount) return false;
  }
  return true;
});

export function RoutesList({ onRefresh, isRefreshing = false, startDate, endDate }: RoutesListProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { groups, totalCount, processedCount, isReady } = useRouteGroups({
    minActivities: 2,
    sortBy: 'count',
    startDate,
    endDate,
  });

  const { progress } = useRouteProcessing();

  const showProcessing =
    progress.status === 'filtering' ||
    progress.status === 'fetching' ||
    progress.status === 'processing' ||
    progress.status === 'matching';

  const showActivityList =
    progress.status === 'processing' ||
    progress.status === 'fetching' ||
    progress.status === 'matching';

  // Memoize routes array reference to prevent unnecessary re-renders
  const routes = useMemo(() => {
    return progress.discoveredRoutes || [];
  }, [progress.discoveredRoutes]);

  const renderHeader = () => (
    <View>
      {/* Discovered routes during processing - show current activity being checked */}
      {showActivityList && (
        <View style={styles.discoveredSection}>
          {/* Current activity - fixed height to prevent jumps */}
          <View style={[styles.currentActivity, isDark && styles.currentActivityDark]}>
            <MaterialCommunityIcons name="magnify" size={14} color={colors.primary} />
            <Text style={[styles.currentActivityText, isDark && styles.textMuted]} numberOfLines={1}>
              {progress.currentActivity ? `Checking: ${progress.currentActivity}` : 'Waiting...'}
            </Text>
          </View>

          {/* Discovered routes list */}
          <DiscoveredRoutesList routes={routes} isDark={isDark} />
        </View>
      )}

      {/* Cache scope notice - show when idle */}
      {!showProcessing && isReady && processedCount > 0 && (
        <CacheScopeNotice
          processedCount={processedCount}
          groupCount={totalCount}
        />
      )}

      {/* Timeline info notice - show when idle and no processing */}
      {!showProcessing && isReady && (
        <View style={[styles.infoNotice, isDark && styles.infoNoticeDark]}>
          <MaterialCommunityIcons
            name="timeline-clock-outline"
            size={14}
            color={isDark ? '#666' : '#999'}
          />
          <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
            Expand the timeline to analyze more activities. Route matching will continue in the background until complete.
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
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            Loading routes...
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
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            Analysing routes
          </Text>
          <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
            This may take a moment...
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
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            No routes yet
          </Text>
          <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
            Routes will appear after your activities are analyzed
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="map-marker-question-outline"
          size={48}
          color={isDark ? '#444' : '#CCC'}
        />
        <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
          No matching routes found
        </Text>
        <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
          Routes with 2+ activities on similar paths will appear here
        </Text>
      </View>
    );
  };

  return (
    <FlatList
      data={groups}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <RouteRow route={item} navigable />}
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={groups.length === 0 ? styles.emptyList : styles.list}
      showsVerticalScrollIndicator={false}
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
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
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
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    borderRadius: 6,
    marginBottom: spacing.sm,
    gap: spacing.xs,
    height: 32, // Fixed height to prevent jumps
  },
  currentActivityDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  currentActivityText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  routesList: {
    maxHeight: 400,
  },
  noRoutesYet: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginHorizontal: spacing.md,
  },
  noRoutesText: {
    fontSize: 13,
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
    fontSize: 12,
    color: '#999',
    lineHeight: 16,
  },
  infoTextDark: {
    color: '#666',
  },
});
