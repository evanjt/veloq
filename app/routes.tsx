import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RoutesList, TimelineSlider } from '@/components';
import { useRouteProcessing, useActivities, useActivityBoundsCache, useRouteGroups } from '@/hooks';
import { colors } from '@/theme';
import type { ActivityType } from '@/types';

export default function RoutesScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { queueActivities } = useRouteProcessing();

  // Get cached bounds for pre-filtering (avoids API calls for isolated routes)
  const {
    activities: boundsData,
    isReady: boundsReady,
    cacheStats,
    progress: syncProgress,
  } = useActivityBoundsCache();

  // Get route groups to count
  const { groups: routeGroups } = useRouteGroups({ minActivities: 1 });

  // Date range state - default to last 3 months
  const now = useMemo(() => new Date(), []);
  const threeMonthsAgo = useMemo(() => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return d;
  }, [now]);

  const [startDate, setStartDate] = useState(threeMonthsAgo);
  const [endDate, setEndDate] = useState(now);

  // Calculate min/max dates from cache - use cache's full range, not just default window
  const { minDate, maxDate } = useMemo(() => {
    // Use cache's oldest date if available, otherwise use 3 months ago
    const oldest = cacheStats.oldestDate ? new Date(cacheStats.oldestDate) : threeMonthsAgo;
    const newest = cacheStats.newestDate ? new Date(cacheStats.newestDate) : now;
    return {
      // Allow slider to go back to cache's oldest date
      minDate: oldest,
      maxDate: newest,
    };
  }, [cacheStats.oldestDate, cacheStats.newestDate, threeMonthsAgo, now]);

  // Cached date range for timeline display
  const cachedOldest = useMemo(
    () => (cacheStats.oldestDate ? new Date(cacheStats.oldestDate) : null),
    [cacheStats.oldestDate]
  );
  const cachedNewest = useMemo(
    () => (cacheStats.newestDate ? new Date(cacheStats.newestDate) : null),
    [cacheStats.newestDate]
  );

  // Handle date range change
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

  // Queue activities for processing when they load and bounds are ready
  useEffect(() => {
    if (activities && activities.length > 0 && boundsReady) {
      const activityIds = activities.map((a) => a.id);
      const metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }> = {};

      for (const activity of activities) {
        metadata[activity.id] = {
          name: activity.name,
          date: activity.start_date_local,
          type: activity.type,
          hasGps: activity.stream_types?.includes('latlng') ?? false,
        };
      }

      // Pass filtered bounds data for pre-filtering
      queueActivities(activityIds, metadata, filteredBoundsData);
    }
  }, [activities, queueActivities, filteredBoundsData, boundsReady]);

  // Convert sync progress to timeline format
  const timelineSyncProgress = useMemo(() => {
    if (syncProgress.status !== 'syncing') return null;
    return {
      completed: syncProgress.completed,
      total: syncProgress.total,
      message: syncProgress.message,
    };
  }, [syncProgress]);

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>Routes</Text>
        <View style={{ width: 48 }} />
      </View>

      {/* Timeline slider for date range selection */}
      <TimelineSlider
        minDate={minDate}
        maxDate={maxDate}
        startDate={startDate}
        endDate={endDate}
        onRangeChange={handleRangeChange}
        isLoading={isLoading}
        activityCount={routeGroups.length}
        syncProgress={timelineSyncProgress}
        cachedOldest={cachedOldest}
        cachedNewest={cachedNewest}
      />

      <RoutesList
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
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
  textLight: {
    color: '#FFFFFF',
  },
});
