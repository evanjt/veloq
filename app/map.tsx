import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  useColorScheme,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RegionalMapView } from '@/components/maps/RegionalMapView';
import { TimelineSlider } from '@/components/maps/TimelineSlider';
import { ActivityTypeFilter } from '@/components/maps/ActivityTypeFilter';
import { useActivityBoundsCache } from '@/hooks';
import { colors } from '@/theme';
import { formatLocalDate } from '@/lib';

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Load cached bounds
  const {
    activities,
    isReady,
    progress,
    syncDateRange,
    oldestSyncedDate,
  } = useActivityBoundsCache();

  const isSyncing = progress.status === 'syncing';

  // Selected date range (default: last 90 days)
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(() => new Date());

  // Selected activity types
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  // Get available activity types from data
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    activities.forEach(a => types.add(a.type));
    return Array.from(types).sort();
  }, [activities]);

  // Initialize selected types when data loads
  useEffect(() => {
    if (availableTypes.length > 0 && selectedTypes.size === 0) {
      setSelectedTypes(new Set(availableTypes));
    }
  }, [availableTypes]);

  // Filter activities by date range and type
  const filteredActivities = useMemo(() => {
    return activities.filter(activity => {
      const activityDate = new Date(activity.date);
      const inDateRange = activityDate >= startDate && activityDate <= endDate;
      const matchesType = selectedTypes.size === 0 || selectedTypes.has(activity.type);
      return inDateRange && matchesType;
    });
  }, [activities, startDate, endDate, selectedTypes]);

  // Handle date range change
  const handleRangeChange = useCallback((start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);

    // Trigger sync for the new date range if needed
    syncDateRange(formatLocalDate(start), formatLocalDate(end));
  }, [syncDateRange]);

  // Handle close
  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // Calculate min/max dates for slider from activities
  // The slider should span from the selected start (or oldest activity) to today
  // NOTE: All hooks must be called before any conditional returns
  const { minDateForSlider, maxDateForSlider } = useMemo(() => {
    const now = new Date();

    if (activities.length === 0) {
      // No activities - use selected range
      return { minDateForSlider: startDate, maxDateForSlider: now };
    }

    // Get min/max from activities
    const dates = activities.map(a => new Date(a.date).getTime());
    const oldestActivityTime = Math.min(...dates);

    // Slider min should be the earliest of: selected start, oldest synced, or oldest activity
    let minTime = oldestActivityTime;
    if (oldestSyncedDate) {
      minTime = Math.min(minTime, new Date(oldestSyncedDate).getTime());
    }
    // Also include selected startDate so slider can show the selected range properly
    minTime = Math.min(minTime, startDate.getTime());

    return {
      minDateForSlider: new Date(minTime),
      maxDateForSlider: now, // Always use today as max
    };
  }, [activities, oldestSyncedDate, startDate]);

  // Show loading state if not ready
  if (!isReady) {
    return (
      <View style={[styles.loadingContainer, isDark && styles.loadingContainerDark]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>
          Loading activities...
        </Text>
        {isSyncing && progress && (
          <Text style={[styles.progressText, isDark && styles.loadingTextDark]}>
            Syncing: {progress.completed}/{progress.total}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Main map view */}
      <RegionalMapView
        activities={filteredActivities}
        onClose={handleClose}
      />

      {/* Activity type filter (top overlay) */}
      <View
        style={[styles.filterContainer, { top: insets.top + 60 }]}
        pointerEvents="box-none"
      >
        <ActivityTypeFilter
          selectedTypes={selectedTypes}
          availableTypes={availableTypes}
          onSelectionChange={setSelectedTypes}
        />
      </View>

      {/* Timeline slider (bottom overlay) */}
      <View
        style={[
          styles.sliderContainer,
          { paddingBottom: insets.bottom },
          isDark && styles.sliderContainerDark
        ]}
        pointerEvents="box-none"
      >
        <TimelineSlider
          minDate={minDateForSlider}
          maxDate={maxDateForSlider}
          startDate={startDate}
          endDate={endDate}
          onRangeChange={handleRangeChange}
          isLoading={isSyncing}
          activityCount={filteredActivities.length}
          syncProgress={isSyncing ? progress : null}
        />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingContainerDark: {
    backgroundColor: '#121212',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.textSecondary,
  },
  loadingTextDark: {
    color: '#AAA',
  },
  progressText: {
    marginTop: 8,
    fontSize: 14,
    color: colors.textSecondary,
  },
  filterContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
  },
  sliderContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  sliderContainerDark: {
    backgroundColor: 'rgba(30, 30, 30, 0.95)',
  },
});
