import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RegionalMapView, TimelineSlider } from '@/components/maps';
import { ComponentErrorBoundary } from '@/components/ui';
import {
  useActivityBoundsCache,
  useOldestActivityDate,
  useActivities,
  useRouteDataSync,
} from '@/hooks';
import { useRouteSettings, useSyncDateRange } from '@/providers';
import { colors, darkColors, spacing, typography } from '@/theme';
import { formatLocalDate } from '@/lib';

export default function MapScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Get route settings
  const { settings: routeSettings } = useRouteSettings();

  // Get the sync date range from global store
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);

  // Fetch the true oldest activity date from API (for timeline extent)
  const { data: apiOldestDate } = useOldestActivityDate();

  // Fetch activities for the current sync range (for cache stats)
  const { data: syncedActivities, isFetching: isFetchingActivities } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    includeStats: false,
  });

  // Load cached bounds - pass activities for cache range calculation
  const { activities, isReady, progress, syncDateRange } = useActivityBoundsCache({
    activitiesWithDates: syncedActivities,
  });

  // Track GPS data sync progress
  const { progress: gpsSyncProgress, isSyncing: isGpsSyncing } = useRouteDataSync(
    syncedActivities,
    routeSettings.enabled
  );

  // Combined syncing state
  const isSyncing =
    progress.status === 'syncing' || isGpsSyncing || isFetchingActivities || isFetchingExtended;

  // Calculate cached range from synced activities
  const { oldestSyncedDate, newestSyncedDate } = useMemo(() => {
    if (!syncedActivities || syncedActivities.length === 0) {
      return { oldestSyncedDate: null, newestSyncedDate: null };
    }
    let oldest: string | null = null;
    let newest: string | null = null;
    for (const a of syncedActivities) {
      const date = a.start_date_local;
      if (date) {
        if (!oldest || date < oldest) oldest = date;
        if (!newest || date > newest) newest = date;
      }
    }
    return { oldestSyncedDate: oldest, newestSyncedDate: newest };
  }, [syncedActivities]);

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
    activities.forEach((a) => types.add(a.type));
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
    return activities.filter((activity) => {
      const activityDate = new Date(activity.date);
      const inDateRange = activityDate >= startDate && activityDate <= endDate;
      const matchesType = selectedTypes.size === 0 || selectedTypes.has(activity.type);
      return inDateRange && matchesType;
    });
  }, [activities, startDate, endDate, selectedTypes]);

  // Handle date range change
  const handleRangeChange = useCallback(
    (start: Date, end: Date) => {
      setStartDate(start);
      setEndDate(end);

      // Trigger sync for the new date range if needed
      syncDateRange(formatLocalDate(start), formatLocalDate(end));
    },
    [syncDateRange]
  );

  // Handle close
  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // Calculate min/max dates for slider
  // Use apiOldestDate from API as the full timeline extent
  const { minDateForSlider, maxDateForSlider } = useMemo(() => {
    const now = new Date();

    // Use the oldest activity date from API if available
    if (apiOldestDate) {
      return {
        minDateForSlider: new Date(apiOldestDate),
        maxDateForSlider: now,
      };
    }

    // Fallback: use cached activities or selected date
    if (activities.length === 0) {
      return { minDateForSlider: startDate, maxDateForSlider: now };
    }

    const dates = activities.map((a) => new Date(a.date).getTime());
    const oldestActivityTime = Math.min(...dates);

    return {
      minDateForSlider: new Date(oldestActivityTime),
      maxDateForSlider: now,
    };
  }, [apiOldestDate, activities, startDate]);

  // Compute sync progress for timeline display
  // Phases: 1) Loading activities, 2) Syncing bounds/GPS, 3) Analyzing routes
  const timelineSyncProgress = useMemo(() => {
    // Phase 1: Loading activities from API
    if (isFetchingActivities || isFetchingExtended) {
      return {
        completed: 0,
        total: 0,
        message: t('mapScreen.loadingActivities') as string,
      };
    }
    // Phase 2: Syncing activity bounds/GPS cache
    if (progress.status === 'syncing' && progress.total > 0) {
      return {
        completed: progress.completed,
        total: progress.total,
        message: t('maps.syncingActivities', {
          completed: progress.completed,
          total: progress.total,
        }) as string,
      };
    }
    // Phase 3: Analyzing routes (GPS sync to Rust engine)
    if (isGpsSyncing && gpsSyncProgress.total > 0) {
      return {
        completed: gpsSyncProgress.completed,
        total: gpsSyncProgress.total,
        message: t('routesScreen.computingRoutes') as string,
      };
    }
    if (gpsSyncProgress.status === 'computing') {
      return { completed: 0, total: 0, message: gpsSyncProgress.message };
    }
    return null;
  }, [isFetchingActivities, isFetchingExtended, progress, isGpsSyncing, gpsSyncProgress, t]);

  // Show loading state if not ready
  if (!isReady) {
    return (
      <View style={[styles.loadingContainer, isDark && styles.loadingContainerDark]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>
          {t('mapScreen.loadingActivities')}
        </Text>
        {isSyncing && progress && (
          <Text style={[styles.progressText, isDark && styles.loadingTextDark]}>
            {t('mapScreen.syncing', {
              completed: progress.completed,
              total: progress.total,
            })}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Main map view */}
      <ComponentErrorBoundary componentName="Map">
        <RegionalMapView activities={filteredActivities} onClose={handleClose} />
      </ComponentErrorBoundary>

      {/* Timeline slider with integrated filters (bottom overlay) */}
      <View
        style={[
          styles.sliderContainer,
          { paddingBottom: insets.bottom },
          isDark && styles.sliderContainerDark,
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
          syncProgress={timelineSyncProgress}
          cachedOldest={oldestSyncedDate ? new Date(oldestSyncedDate) : null}
          cachedNewest={newestSyncedDate ? new Date(newestSyncedDate) : null}
          selectedTypes={selectedTypes}
          availableTypes={availableTypes}
          onTypeSelectionChange={setSelectedTypes}
          isDark={isDark}
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
    backgroundColor: darkColors.background,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.body.fontSize,
    color: colors.textSecondary,
  },
  loadingTextDark: {
    color: darkColors.textSecondary,
  },
  progressText: {
    marginTop: spacing.sm,
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
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
