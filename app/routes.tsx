import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RoutesList } from '@/components';
import { useRouteProcessing, useActivities, useActivityBoundsCache, useRouteGroups } from '@/hooks';
import { colors, spacing } from '@/theme';
import type { ActivityType } from '@/types';

// Date range presets
type DatePreset = '3m' | '6m' | '1y' | 'all';

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

export default function RoutesScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { queueActivities, isProcessing, progress: routeProgress } = useRouteProcessing();

  // Get cached bounds for pre-filtering (avoids API calls for isolated routes)
  const {
    activities: boundsData,
    isReady: boundsReady,
    oldestActivityDate,
    progress: syncProgress,
    syncDateRange,
  } = useActivityBoundsCache();

  // Get route groups to count (use minActivities: 2 to match the list)
  const { groups: routeGroups } = useRouteGroups({ minActivities: 2 });

  // Date range state
  const now = useMemo(() => new Date(), []);
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>('3m');

  // Calculate dates from preset
  const { startDate, endDate } = useMemo(() => {
    const end = now;
    let start: Date;

    switch (selectedPreset) {
      case '3m':
        start = new Date(now);
        start.setMonth(start.getMonth() - 3);
        break;
      case '6m':
        start = new Date(now);
        start.setMonth(start.getMonth() - 6);
        break;
      case '1y':
        start = new Date(now);
        start.setFullYear(start.getFullYear() - 1);
        break;
      case 'all':
        // Use oldest activity date from API
        start = oldestActivityDate ? new Date(oldestActivityDate) : new Date(now.getFullYear() - 10, 0, 1);
        break;
    }

    return { startDate: start, endDate: end };
  }, [selectedPreset, now, oldestActivityDate]);

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

  const handlePresetChange = useCallback((preset: DatePreset) => {
    setSelectedPreset(preset);
  }, []);

  // Trigger bounds sync when date range changes to a larger range
  useEffect(() => {
    if (boundsReady) {
      // Sync the full date range to ensure we have bounds for all activities
      syncDateRange(oldestStr, newestStr);
    }
  }, [oldestStr, newestStr, boundsReady, syncDateRange]);

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

      {/* Simple date range picker */}
      <View style={[styles.dateRangeContainer, isDark && styles.dateRangeContainerDark]}>
        <View style={styles.presetRow}>
          {(['3m', '6m', '1y', 'all'] as DatePreset[]).map((preset) => (
            <TouchableOpacity
              key={preset}
              style={[
                styles.presetButton,
                selectedPreset === preset && styles.presetButtonActive,
                isDark && styles.presetButtonDark,
                selectedPreset === preset && isDark && styles.presetButtonActiveDark,
              ]}
              onPress={() => handlePresetChange(preset)}
            >
              <Text
                style={[
                  styles.presetText,
                  selectedPreset === preset && styles.presetTextActive,
                  isDark && styles.presetTextDark,
                ]}
              >
                {preset === 'all' ? 'All' : preset.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Date range display */}
        <View style={styles.dateRangeInfo}>
          <Text style={[styles.dateRangeText, isDark && styles.textMuted]}>
            {formatShortDate(startDate)} — {formatShortDate(endDate)}
          </Text>
          {(isLoading || isProcessing || syncProgress.status === 'syncing') && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, isDark && styles.textMuted]}>
                {syncProgress.status === 'syncing'
                  ? `Syncing GPS traces ${syncProgress.completed}/${syncProgress.total}`
                  : isProcessing
                    ? `Analyzing ${routeProgress.current}/${routeProgress.total}`
                    : 'Loading...'}
              </Text>
            </View>
          )}
        </View>

        {/* Route count */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <MaterialCommunityIcons
              name="map-marker-path"
              size={16}
              color={colors.primary}
            />
            <Text style={[styles.statValue, isDark && styles.textLight]}>
              {routeGroups.length}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.textMuted]}>
              routes found
            </Text>
          </View>
          {activities && (
            <View style={styles.statItem}>
              <MaterialCommunityIcons
                name="lightning-bolt"
                size={16}
                color={isDark ? '#888' : colors.textSecondary}
              />
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {activities.length}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>
                activities
              </Text>
            </View>
          )}
        </View>
      </View>

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
  textMuted: {
    color: '#888',
  },
  dateRangeContainer: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: 12,
    padding: spacing.md,
  },
  dateRangeContainerDark: {
    backgroundColor: '#1E1E1E',
  },
  presetRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  presetButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    alignItems: 'center',
  },
  presetButtonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  presetButtonActive: {
    backgroundColor: colors.primary,
  },
  presetButtonActiveDark: {
    backgroundColor: colors.primary,
  },
  presetText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  presetTextDark: {
    color: '#888',
  },
  presetTextActive: {
    color: '#FFFFFF',
  },
  dateRangeInfo: {
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  dateRangeText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  loadingText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
