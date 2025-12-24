/**
 * Routes list component.
 * Main list showing all route groups.
 */

import React, { useEffect, useRef, memo, useMemo } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, useColorScheme, Animated, LayoutAnimation, Platform, UIManager } from 'react-native';

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

// Memoized stats bar - only updates when values change
const StatsBar = memo(function StatsBar({
  routeCount,
  current,
  total,
  cachedCount,
  isDark,
}: {
  routeCount: number;
  current: number;
  total: number;
  cachedCount: number;
  isDark: boolean;
}) {
  return (
    <View style={[styles.statsBar, isDark && styles.statsBarDark]}>
      <View style={styles.statItem}>
        <MaterialCommunityIcons name="map-marker-path" size={16} color={colors.success} />
        <Text style={[styles.statValue, { color: colors.success }]}>
          {routeCount}
        </Text>
        <Text style={[styles.statLabel, isDark && styles.textMuted]}>routes</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <MaterialCommunityIcons name="timer-outline" size={16} color={isDark ? '#888' : colors.textSecondary} />
        <Text style={[styles.statValue, isDark && styles.textLight]}>
          {current}/{total}
        </Text>
        <Text style={[styles.statLabel, isDark && styles.textMuted]}>checked</Text>
      </View>
      {cachedCount > 0 && (
        <>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <MaterialCommunityIcons name="database-outline" size={16} color={isDark ? '#888' : colors.textSecondary} />
            <Text style={[styles.statValue, isDark && styles.textLight]}>
              {cachedCount}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.textMuted]}>cached</Text>
          </View>
        </>
      )}
    </View>
  );
});

export function RoutesList({ onRefresh, isRefreshing = false }: RoutesListProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { groups, totalCount, processedCount, isReady } = useRouteGroups({
    minActivities: 2,
    sortBy: 'count',
  });

  const { progress } = useRouteProcessing();

  // Animated progress value for smooth transitions
  const animatedProgress = useRef(new Animated.Value(0)).current;

  // Update animated progress smoothly
  useEffect(() => {
    const targetValue = progress.total > 0 ? progress.current / progress.total : 0;
    Animated.timing(animatedProgress, {
      toValue: targetValue,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progress.current, progress.total, animatedProgress]);

  const showProcessing =
    progress.status === 'filtering' ||
    progress.status === 'fetching' ||
    progress.status === 'processing' ||
    progress.status === 'matching';

  // Interpolate width as percentage string
  const progressWidth = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

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
      {/* Progress banner header */}
      {(showProcessing || progress.status === 'complete') && (
        <View style={[styles.progressBanner, isDark && styles.progressBannerDark]}>
          <View style={styles.progressHeader}>
            <MaterialCommunityIcons
              name={progress.status === 'complete' ? 'check-circle' : 'map-marker-path'}
              size={18}
              color={progress.status === 'complete' ? colors.success : colors.primary}
            />
            <Text style={[styles.progressTitle, isDark && styles.textLight]}>
              {progress.status === 'complete'
                ? `Found ${progress.matchesFound || 0} matches`
                : progress.status === 'filtering'
                  ? 'Finding candidates...'
                  : 'Analysing routes'}
            </Text>
            {showProcessing && (
              <Text style={[styles.progressCount, isDark && styles.textMuted]}>
                {progress.status === 'filtering'
                  ? progress.candidatesFound !== undefined
                    ? `${progress.candidatesFound} found`
                    : `Checking...`
                  : `${progress.current}/${progress.total}`}
              </Text>
            )}
          </View>
          {showProcessing && (
            <View style={[styles.progressBar, isDark && styles.progressBarDark]}>
              <Animated.View
                style={[
                  styles.progressFill,
                  { width: progressWidth },
                ]}
              />
            </View>
          )}
          {progress.status === 'filtering' && (
            <Text style={[styles.progressSubtext, isDark && styles.textMuted]}>
              Comparing bounding boxes (no network)...
            </Text>
          )}
        </View>
      )}

      {/* Discovered routes during processing */}
      {showActivityList && (
        <View style={styles.discoveredSection}>
          {/* Stats bar */}
          <StatsBar
            routeCount={routes.length}
            current={progress.current}
            total={progress.total}
            cachedCount={progress.cachedSignatureCount || 0}
            isDark={isDark}
          />

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
      {!showProcessing && progress.status !== 'complete' && isReady && processedCount > 0 && (
        <CacheScopeNotice
          processedCount={processedCount}
          groupCount={totalCount}
        />
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
  progressBanner: {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: 12,
    padding: spacing.md,
  },
  progressBannerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  progressCount: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  progressBar: {
    marginTop: spacing.sm,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
  },
  progressBarDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressSubtext: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  discoveredSection: {
    marginBottom: spacing.md,
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    marginHorizontal: spacing.md,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  statsBarDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  statDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
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
});
