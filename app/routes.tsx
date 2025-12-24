import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RoutesList, TimelineSlider } from '@/components';
import { useRouteProcessing, useActivities, useActivityBoundsCache, useRouteGroups } from '@/hooks';
import { useRouteMatchStore, useRouteSettings } from '@/providers';
import { colors, spacing } from '@/theme';
import type { ActivityType } from '@/types';

export default function RoutesScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Check if route matching is enabled
  const { settings: routeSettings } = useRouteSettings();
  const isRouteMatchingEnabled = routeSettings.enabled;

  const { queueActivities, isProcessing, progress: routeProgress } = useRouteProcessing();

  // Get processed activity IDs from cache to skip already-analyzed activities
  const processedActivityIds = useRouteMatchStore((s) => s.cache?.processedActivityIds || []);
  const processedSet = useMemo(() => new Set(processedActivityIds), [processedActivityIds]);

  // Get cached bounds for pre-filtering (avoids API calls for isolated routes)
  const {
    activities: boundsData,
    isReady: boundsReady,
    oldestActivityDate,
    oldestSyncedDate,
    newestSyncedDate,
    progress: syncProgress,
    syncDateRange,
  } = useActivityBoundsCache();

  // Get route groups to count (use minActivities: 2 to match the list)
  const { groups: routeGroups } = useRouteGroups({ minActivities: 2 });

  // Date range state - default to full cached range, or last 3 months if no cache
  const now = useMemo(() => new Date(), []);
  const fallbackStart = useMemo(() => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return d;
  }, [now]);

  // Track if we've initialized from cache
  const [hasInitialized, setHasInitialized] = useState(false);

  // Calculate default dates from cache
  const cachedStart = oldestSyncedDate ? new Date(oldestSyncedDate) : null;
  const cachedEnd = newestSyncedDate ? new Date(newestSyncedDate) : null;

  const [startDate, setStartDate] = useState<Date>(fallbackStart);
  const [endDate, setEndDate] = useState<Date>(now);

  // Initialize to full cached range once available
  useEffect(() => {
    if (!hasInitialized && boundsReady && cachedStart && cachedEnd) {
      setStartDate(cachedStart);
      setEndDate(cachedEnd);
      setHasInitialized(true);
    }
  }, [hasInitialized, boundsReady, cachedStart, cachedEnd]);

  // Min/max dates for timeline
  const minDate = useMemo(() => {
    return oldestActivityDate ? new Date(oldestActivityDate) : new Date(now.getFullYear() - 5, 0, 1);
  }, [oldestActivityDate, now]);

  // Max date is always "now" (today)
  const maxDate = now;

  // Handle timeline range changes
  const handleRangeChange = useCallback((start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  // Format dates for API
  const oldestStr = useMemo(() => startDate.toISOString().split('T')[0], [startDate]);
  const newestStr = useMemo(() => endDate.toISOString().split('T')[0], [endDate]);

  // Fetch activities for route processing based on selected date range
  const { data: activities, refetch, isRefetching, isLoading } = useActivities({
    oldest: oldestStr,
    newest: newestStr,
    includeStats: false,
  });

  // Filter bounds data to selected date range
  const filteredBoundsData = useMemo(() => {
    return boundsData.filter((b) => {
      const date = new Date(b.date);
      return date >= startDate && date <= endDate;
    });
  }, [boundsData, startDate, endDate]);

  // Track if we've already queued for the current date range to avoid duplicate calls
  const lastQueuedRange = React.useRef<string | null>(null);
  const rangeKey = `${oldestStr}-${newestStr}`;

  // Trigger bounds sync when date range changes
  useEffect(() => {
    if (boundsReady) {
      // Sync the full date range to ensure we have bounds for all activities
      syncDateRange(oldestStr, newestStr);
    }
  }, [oldestStr, newestStr, boundsReady, syncDateRange]);

  // Queue activities for processing ONLY when:
  // 1. Activities have loaded
  // 2. Bounds are ready (initial load complete)
  // 3. Sync is NOT currently in progress (wait for bounds to finish)
  // 4. We haven't already queued for this date range
  const isSyncing = syncProgress.status === 'syncing';

  useEffect(() => {
    // Don't queue if route matching is disabled
    if (!isRouteMatchingEnabled) {
      return;
    }

    // Don't queue while bounds are still syncing - wait for complete data
    if (isSyncing) {
      return;
    }

    // Don't queue if we've already processed this range
    if (lastQueuedRange.current === rangeKey) {
      return;
    }

    if (activities && activities.length > 0 && boundsReady && !isProcessing) {
      // Filter out already-processed activities - no need to re-analyze cached data
      const unprocessedActivities = activities.filter((a) => !processedSet.has(a.id));

      // Mark this range as queued (even if all are processed, to avoid re-checking)
      lastQueuedRange.current = rangeKey;

      // If all activities are already processed, skip queueing entirely
      if (unprocessedActivities.length === 0) {
        console.log(`[Routes] All ${activities.length} activities already processed, skipping analysis`);
        return;
      }

      console.log(`[Routes] Queueing ${unprocessedActivities.length} unprocessed activities (${activities.length - unprocessedActivities.length} already cached)`);

      const activityIds = unprocessedActivities.map((a) => a.id);
      const metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }> = {};

      for (const activity of unprocessedActivities) {
        metadata[activity.id] = {
          name: activity.name,
          date: activity.start_date_local,
          type: activity.type,
          hasGps: activity.stream_types?.includes('latlng') ?? false,
        };
      }

      // Filter bounds data to only include unprocessed activities
      const unprocessedBoundsData = filteredBoundsData.filter((b) => !processedSet.has(b.id));

      // Pass filtered bounds data for pre-filtering
      queueActivities(activityIds, metadata, unprocessedBoundsData);
    }
  }, [activities, queueActivities, filteredBoundsData, boundsReady, isSyncing, isProcessing, rangeKey, processedSet, isRouteMatchingEnabled]);

  // Convert sync/processing progress to timeline format
  // Show banner for both bounds syncing AND route processing
  const timelineSyncProgress = useMemo(() => {
    // Show bounds syncing progress
    if (syncProgress.status === 'syncing') {
      return {
        completed: syncProgress.completed,
        total: syncProgress.total,
        message: undefined,
      };
    }
    // Show route processing progress after syncing is done
    if (isProcessing && routeProgress.total > 0) {
      return {
        completed: routeProgress.current,
        total: routeProgress.total,
        message: `Analyzing routes ${routeProgress.current}/${routeProgress.total}`,
      };
    }
    return null;
  }, [syncProgress, isProcessing, routeProgress]);

  // Show disabled state if route matching is not enabled
  if (!isRouteMatchingEnabled) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Routes</Text>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.disabledContainer}>
          <MaterialCommunityIcons
            name="map-marker-off"
            size={64}
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.disabledTitle, isDark && styles.textLight]}>
            Route Matching Disabled
          </Text>
          <Text style={[styles.disabledText, isDark && styles.textMuted]}>
            Enable route matching in Settings to automatically detect repeated routes from your activities.
          </Text>
          <IconButton
            icon="cog"
            iconColor={colors.primary}
            size={32}
            onPress={() => router.push('/settings')}
          />
          <Text style={[styles.disabledHint, isDark && styles.textMuted]}>
            Go to Settings
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>Routes</Text>
        <View style={styles.headerRight}>
          <View style={styles.routeCountBadge}>
            <MaterialCommunityIcons name="map-marker-path" size={14} color="#FFFFFF" />
            <Text style={styles.routeCountText}>{routeGroups.length}</Text>
          </View>
        </View>
      </View>

      {/* Timeline slider - same as world map */}
      <TimelineSlider
        minDate={minDate}
        maxDate={maxDate}
        startDate={startDate}
        endDate={endDate}
        onRangeChange={handleRangeChange}
        isLoading={isLoading || isProcessing}
        activityCount={activities?.length || 0}
        syncProgress={timelineSyncProgress}
        cachedOldest={oldestSyncedDate ? new Date(oldestSyncedDate) : null}
        cachedNewest={newestSyncedDate ? new Date(newestSyncedDate) : null}
        isDark={isDark}
      />

      <RoutesList
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
        startDate={startDate}
        endDate={endDate}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerRight: {
    width: 48,
    alignItems: 'flex-end',
    paddingRight: spacing.sm,
  },
  routeCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  routeCountText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
  disabledContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  disabledTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  disabledText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  disabledHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: -spacing.sm,
  },
});
