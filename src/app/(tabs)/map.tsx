import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RegionalMapView, TimelineSlider, SyncProgressBanner } from '@/components/maps';
import { ComponentErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import {
  useActivityBoundsCache,
  useOldestActivityDate,
  useActivities,
  useTheme,
  useEngineMapActivities,
} from '@/hooks';
import { useRouteSettings, useSyncDateRange } from '@/providers';
import { colors, darkColors, spacing, typography } from '@/theme';
import { createSharedStyles } from '@/styles';
import { formatLocalDate } from '@/lib';

// Debounce delay for expensive operations during timeline scrubbing
const FILTER_DEBOUNCE_MS = 100;

export default function MapScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('MapScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);

  // Attribution text from map (updated dynamically)
  const [attribution, setAttribution] = useState('© OpenFreeMap © OpenMapTiles © OpenStreetMap');

  // Get route settings
  const { settings: routeSettings } = useRouteSettings();

  // Get the sync date range from global store
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);

  // Fetch the true oldest activity date from API (for timeline extent)
  const { data: apiOldestDate } = useOldestActivityDate();

  // Fetch activities for the current sync range (triggers GlobalDataSync)
  const { isFetching: isFetchingActivities } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    includeStats: false,
  });

  // Get sync state from engine cache
  const { isReady, progress, syncDateRange, cacheStats } = useActivityBoundsCache();
  const oldestSyncedDate = cacheStats.oldestDate;
  const newestSyncedDate = cacheStats.newestDate;

  // Read GPS sync progress from shared store (GlobalDataSync is the single sync coordinator)
  const gpsSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);

  // Combined syncing state
  const isSyncing =
    progress.status === 'syncing' || isGpsSyncing || isFetchingActivities || isFetchingExtended;

  // Selected date range (default: last 90 days)
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(() => new Date());

  // Selected activity types
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  // Get filtered activities directly from Rust engine
  // Filtering happens in Rust (single O(n) pass) - no JS filtering needed
  const { activities: filteredActivities, availableTypes } = useEngineMapActivities({
    startDate,
    endDate,
    selectedTypes,
    enabled: isReady,
  });

  // Initialize selected types when data loads
  useEffect(() => {
    if (availableTypes.length > 0 && selectedTypes.size === 0) {
      setSelectedTypes(new Set(availableTypes));
    }
  }, [availableTypes]);

  // Debounced sync for date range changes during timeline scrubbing
  // This prevents hammering the API while the user drags the slider
  const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle date range change - update state immediately, debounce sync
  const handleRangeChange = useCallback(
    (start: Date, end: Date) => {
      // Update local state immediately for responsive UI
      setStartDate(start);
      setEndDate(end);

      // Clear any pending sync
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
      }

      // Debounce the expensive sync operation
      syncDebounceRef.current = setTimeout(() => {
        // Only request sync if the range extends beyond what's already synced
        // This prevents unnecessary API calls when selecting a range within cached data
        const requestedStart = formatLocalDate(start);
        const requestedEnd = formatLocalDate(end);
        const needsExpansion = requestedStart < syncOldest || requestedEnd > syncNewest;

        if (needsExpansion) {
          syncDateRange(requestedStart, requestedEnd);
        }
      }, FILTER_DEBOUNCE_MS);
    },
    [syncDateRange, syncOldest, syncNewest]
  );

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
      }
    };
  }, []);

  // Handle close
  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // Calculate min/max dates for slider using API oldest date
  const { minDateForSlider, maxDateForSlider } = useMemo(() => {
    const now = new Date();
    // Use API oldest date, fallback to 90 days ago if not available yet
    const minDate = apiOldestDate ? new Date(apiOldestDate) : startDate;
    return { minDateForSlider: minDate, maxDateForSlider: now };
  }, [apiOldestDate, startDate]);

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
          showAttribution={false}
          onAttributionChange={setAttribution}
        />
      </ComponentErrorBoundary>

      {/* Timeline slider with integrated filters (bottom overlay) */}
      <View
        style={[
          styles.sliderContainer,
          { paddingBottom: TAB_BAR_SAFE_PADDING },
          isDark && styles.sliderContainerDark,
        ]}
        pointerEvents="box-none"
      >
        {/* Attribution pill - positioned at top right of panel */}
        <View style={[styles.attributionPill, isDark && styles.attributionPillDark]}>
          <Text style={[styles.attributionText, isDark && styles.attributionTextDark]}>
            {attribution}
          </Text>
        </View>
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
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
  sliderContainerDark: {
    backgroundColor: 'rgba(30, 30, 30, 0.85)',
  },
  attributionPill: {
    position: 'absolute',
    top: -19,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderTopLeftRadius: spacing.sm,
    zIndex: 1,
  },
  attributionPillDark: {
    backgroundColor: 'rgba(30, 30, 30, 0.8)',
  },
  attributionText: {
    fontSize: 9,
    color: colors.textSecondary,
  },
  attributionTextDark: {
    color: darkColors.textSecondary,
  },
});
