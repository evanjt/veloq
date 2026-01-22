import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { RegionalMapView, TimelineSlider, SyncProgressBanner } from '@/components/maps';
import { ComponentErrorBoundary } from '@/components/ui';
import { useActivityBoundsCache, useOldestActivityDate, useActivities, useTheme } from '@/hooks';
import { useRouteSettings, useSyncDateRange } from '@/providers';
import { colors, darkColors, spacing, typography } from '@/theme';
import { createSharedStyles } from '@/styles';
import { formatLocalDate } from '@/lib';
import type { Activity } from '@/types';

export default function MapScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const queryClient = useQueryClient();

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

  // Read GPS sync progress from shared store (GlobalDataSync is the single sync coordinator)
  const gpsSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);

  // Combined syncing state
  const isSyncing =
    progress.status === 'syncing' || isGpsSyncing || isFetchingActivities || isFetchingExtended;

  // Calculate cached range from activities that are actually in the Rust engine
  // This shows the full extent of cached GPS data (not old API fetches)
  const { oldestSyncedDate, newestSyncedDate } = useMemo(() => {
    // Get activity IDs that are actually in the engine
    const { getRouteEngine } = require('@/lib/native/routeEngine');
    const engine = getRouteEngine();
    if (!engine) {
      return { oldestSyncedDate: null, newestSyncedDate: null };
    }

    const engineIds = new Set(engine.getActivityIds());
    if (engineIds.size === 0) {
      return { oldestSyncedDate: null, newestSyncedDate: null };
    }

    // Get all activities from TanStack Query cache
    const queries = queryClient.getQueriesData<Activity[]>({
      queryKey: ['activities'],
    });

    let oldest: string | null = null;
    let newest: string | null = null;

    // Only consider activities that are in the engine (actually cached with GPS data)
    for (const [_key, data] of queries) {
      if (!data) continue;
      for (const activity of data) {
        if (!engineIds.has(activity.id)) continue; // Skip if not in engine
        const date = activity.start_date_local;
        if (date) {
          if (!oldest || date < oldest) oldest = date;
          if (!newest || date > newest) newest = date;
        }
      }
    }

    return { oldestSyncedDate: oldest, newestSyncedDate: newest };
  }, [queryClient, activities]); // Re-compute when activities change

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
  // Unified progress across all phases (0-100%) for smooth animation
  // Phase weights: Loading=10%, Syncing bounds=20%, Downloading GPS=30%, Analyzing=40%
  const timelineSyncProgress = useMemo(() => {
    // Phase 1: Loading activities from API (0-10%)
    if (isFetchingActivities || isFetchingExtended) {
      // Indeterminate progress during initial load
      return {
        completed: 5,
        total: 100,
        message: t('mapScreen.loadingActivities') as string,
      };
    }

    // Phase 2: Syncing activity bounds/GPS cache (10-30%)
    if (progress.status === 'syncing') {
      const phaseProgress = progress.total > 0 ? progress.completed / progress.total : 0;
      const overallProgress = Math.round(10 + phaseProgress * 20);
      return {
        completed: overallProgress,
        total: 100,
        message: t('maps.syncingActivities', {
          completed: progress.completed,
          total: progress.total,
        }) as string,
      };
    }

    // Phase 3a: Downloading GPS data (30-60%)
    if (isGpsSyncing && gpsSyncProgress.status === 'fetching') {
      const phaseProgress =
        gpsSyncProgress.total > 0 ? gpsSyncProgress.completed / gpsSyncProgress.total : 0;
      const overallProgress = Math.round(30 + phaseProgress * 30);
      return {
        completed: overallProgress,
        total: 100,
        message: t('routesScreen.downloadingGps', {
          completed: gpsSyncProgress.completed,
          total: gpsSyncProgress.total,
        }) as string,
      };
    }

    // Phase 3b: Computing routes/sections (60-100%)
    if (gpsSyncProgress.status === 'computing') {
      const phaseProgress =
        gpsSyncProgress.total > 0 ? gpsSyncProgress.completed / gpsSyncProgress.total : 0;
      const overallProgress = Math.round(60 + phaseProgress * 40);
      return {
        completed: overallProgress,
        total: 100,
        message: gpsSyncProgress.message || (t('routesScreen.computingRoutes') as string),
      };
    }

    return null;
  }, [isFetchingActivities, isFetchingExtended, progress, isGpsSyncing, gpsSyncProgress, t]);

  // Compute loading screen progress (unified 0-100% like timelineSyncProgress)
  const loadingProgress = useMemo(() => {
    // Phase 1: Loading activities from API (0-10%)
    if (isFetchingActivities || isFetchingExtended) {
      return {
        completed: 5,
        total: 100,
        message: t('mapScreen.loadingActivities') as string,
      };
    }

    // Phase 2: Syncing activity bounds/GPS cache (10-30%)
    if (progress.status === 'syncing') {
      const phaseProgress = progress.total > 0 ? progress.completed / progress.total : 0;
      const overallProgress = Math.round(10 + phaseProgress * 20);
      return {
        completed: overallProgress,
        total: 100,
        message: t('maps.syncingActivities', {
          completed: progress.completed,
          total: progress.total,
        }) as string,
      };
    }

    // Phase 3a: Downloading GPS data (30-60%)
    if (isGpsSyncing && gpsSyncProgress.status === 'fetching') {
      const phaseProgress =
        gpsSyncProgress.total > 0 ? gpsSyncProgress.completed / gpsSyncProgress.total : 0;
      const overallProgress = Math.round(30 + phaseProgress * 30);
      return {
        completed: overallProgress,
        total: 100,
        message: t('routesScreen.downloadingGps', {
          completed: gpsSyncProgress.completed,
          total: gpsSyncProgress.total,
        }) as string,
      };
    }

    // Phase 3b: Computing routes/sections (60-100%)
    if (gpsSyncProgress.status === 'computing') {
      const phaseProgress =
        gpsSyncProgress.total > 0 ? gpsSyncProgress.completed / gpsSyncProgress.total : 0;
      const overallProgress = Math.round(60 + phaseProgress * 40);
      return {
        completed: overallProgress,
        total: 100,
        message: gpsSyncProgress.message || (t('routesScreen.computingRoutes') as string),
      };
    }

    return null;
  }, [isFetchingActivities, isFetchingExtended, progress, isGpsSyncing, gpsSyncProgress, t]);

  // Show loading state if not ready
  if (!isReady) {
    return (
      <View
        testID="map-screen"
        style={[styles.loadingContainer, isDark && styles.loadingContainerDark]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>
          {t('mapScreen.loadingActivities')}
        </Text>
        <View style={styles.loadingBannerContainer}>
          <SyncProgressBanner
            completed={loadingProgress?.completed ?? 0}
            total={loadingProgress?.total ?? 100}
            message={loadingProgress?.message}
            visible={!!loadingProgress}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="map-screen">
      {/* Main map view */}
      <ComponentErrorBoundary componentName="Map">
        <RegionalMapView
          activities={filteredActivities}
          onClose={handleClose}
          attributionBottomOffset={160}
        />
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
    backgroundColor: darkColors.background,
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
  loadingBannerContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
