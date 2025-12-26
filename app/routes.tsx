import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, useColorScheme, Pressable } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RoutesList, SectionsList, TimelineSlider } from '@/components';
import { useRouteProcessing, useActivities, useActivityBoundsCache, useRouteGroups, useFrequentSections } from '@/hooks';
import { useRouteMatchStore, useRouteSettings } from '@/providers';
import { colors, spacing } from '@/theme';
import { debug } from '@/lib';
import type { ActivityType } from '@/types';

type TabType = 'routes' | 'sections';

const log = debug.create('Routes');

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

  // Get frequent sections count
  const { sections, totalCount: totalSections } = useFrequentSections({ minVisits: 3 });

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('routes');

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
  // 5. Route processing is idle (not processing or just completed)
  const isSyncing = syncProgress.status === 'syncing';
  const isIdle = routeProgress.status === 'idle';

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

    // Don't queue if route processing is in progress or just completed
    // Only queue when status is 'idle' to avoid race conditions
    if (!isIdle) {
      return;
    }

    if (activities && activities.length > 0 && boundsReady && !isProcessing) {
      // Filter out already-processed activities - no need to re-analyze cached data
      const unprocessedActivities = activities.filter((a) => !processedSet.has(a.id));

      // Mark this range as queued (even if all are processed, to avoid re-checking)
      lastQueuedRange.current = rangeKey;

      // If all activities are already processed, skip queueing entirely
      if (unprocessedActivities.length === 0) {
        log.log(`All ${activities.length} activities already processed, skipping analysis`);
        return;
      }

      log.log(`Queueing ${unprocessedActivities.length} unprocessed activities (${activities.length - unprocessedActivities.length} already cached)`);

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
  }, [activities, queueActivities, filteredBoundsData, boundsReady, isSyncing, isProcessing, isIdle, rangeKey, processedSet, isRouteMatchingEnabled]);

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
        <View style={styles.headerRight} />
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabBar, isDark && styles.tabBarDark]}>
        <Pressable
          style={[
            styles.tab,
            activeTab === 'routes' && styles.tabActive,
            activeTab === 'routes' && isDark && styles.tabActiveDark,
          ]}
          onPress={() => setActiveTab('routes')}
        >
          <MaterialCommunityIcons
            name="map-marker-path"
            size={16}
            color={activeTab === 'routes' ? colors.primary : (isDark ? '#888' : colors.textSecondary)}
          />
          <Text style={[
            styles.tabText,
            activeTab === 'routes' && styles.tabTextActive,
            isDark && styles.tabTextDark,
          ]}>
            Routes
          </Text>
          <View style={[styles.tabBadge, activeTab === 'routes' && styles.tabBadgeActive]}>
            <Text style={[styles.tabBadgeText, activeTab === 'routes' && styles.tabBadgeTextActive]}>
              {routeGroups.length}
            </Text>
          </View>
        </Pressable>

        <Pressable
          style={[
            styles.tab,
            activeTab === 'sections' && styles.tabActive,
            activeTab === 'sections' && isDark && styles.tabActiveDark,
          ]}
          onPress={() => setActiveTab('sections')}
        >
          <MaterialCommunityIcons
            name="road-variant"
            size={16}
            color={activeTab === 'sections' ? colors.primary : (isDark ? '#888' : colors.textSecondary)}
          />
          <Text style={[
            styles.tabText,
            activeTab === 'sections' && styles.tabTextActive,
            isDark && styles.tabTextDark,
          ]}>
            Sections
          </Text>
          <View style={[styles.tabBadge, activeTab === 'sections' && styles.tabBadgeActive]}>
            <Text style={[styles.tabBadgeText, activeTab === 'sections' && styles.tabBadgeTextActive]}>
              {sections.length}
            </Text>
          </View>
        </Pressable>
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

      {activeTab === 'routes' ? (
        <RoutesList
          onRefresh={() => refetch()}
          isRefreshing={isRefetching}
          startDate={startDate}
          endDate={endDate}
        />
      ) : (
        <SectionsList />
      )}
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
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  tabBarDark: {
    backgroundColor: '#121212',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: '#F0F0F0',
  },
  tabActive: {
    backgroundColor: '#FFF3ED',
  },
  tabActiveDark: {
    backgroundColor: 'rgba(252, 76, 2, 0.15)',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  tabTextDark: {
    color: '#888',
  },
  tabBadge: {
    backgroundColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  tabBadgeActive: {
    backgroundColor: colors.primary,
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabBadgeTextActive: {
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
