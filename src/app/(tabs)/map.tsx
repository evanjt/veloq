import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { RegionalMapView, SyncProgressBanner } from '@/components/maps';
import {
  ComponentErrorBoundary,
  ScreenErrorBoundary,
  ErrorStatePreset,
  TAB_BAR_SAFE_PADDING,
} from '@/components/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import {
  useActivityBoundsCache,
  useActivities,
  useTheme,
  useMetricSystem,
  useEngineMapActivities,
} from '@/hooks';
import { useAuthStore, useSyncDateRange } from '@/providers';
import { colors, darkColors, spacing, typography } from '@/theme';
import {
  getActivityTypeConfig,
  groupTypesByCategory,
  ACTIVITY_CATEGORIES,
} from '@/components/maps/ActivityTypeFilter';

// Stable date references — creating new Date() in the component body triggers
// useEngineMapActivities useMemo on every render, causing cascading re-renders
// that make Android MapLibre snap the camera back.
const ALL_TIME_START = new Date('2000-01-01');
const ALL_TIME_END = new Date('2099-12-31');

type PeriodKey = 'all' | 'year' | '6m' | '3m' | '1m' | '1w';
type DistanceKey = 'all' | 'xshort' | 'short' | 'medium' | 'long';

// Pre-compute period start dates (stable references, computed once)
function getPeriodStart(period: PeriodKey): Date {
  if (period === 'all') return ALL_TIME_START;
  const d = new Date();
  if (period === 'year') {
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
  } else if (period === '6m') d.setMonth(d.getMonth() - 6);
  else if (period === '3m') d.setMonth(d.getMonth() - 3);
  else if (period === '1m') d.setMonth(d.getMonth() - 1);
  else if (period === '1w') d.setDate(d.getDate() - 7);
  return d;
}

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'year', label: 'This year' },
  { key: '6m', label: '6 mo' },
  { key: '3m', label: '3 mo' },
  { key: '1m', label: '1 mo' },
  { key: '1w', label: '1 wk' },
];

// Distance thresholds in meters (metric) and labels for both systems
function getDistanceOptions(isMetric: boolean): { key: DistanceKey; label: string }[] {
  return isMetric
    ? [
        { key: 'all', label: 'Any' },
        { key: 'xshort', label: '<5km' },
        { key: 'short', label: '5–10km' },
        { key: 'medium', label: '10–50km' },
        { key: 'long', label: '50km+' },
      ]
    : [
        { key: 'all', label: 'Any' },
        { key: 'xshort', label: '<3mi' },
        { key: 'short', label: '3–6mi' },
        { key: 'medium', label: '6–30mi' },
        { key: 'long', label: '30mi+' },
      ];
}

// Thresholds in meters — imperial uses approximate mile equivalents
function getDistanceThresholds(isMetric: boolean) {
  return isMetric
    ? { xshort: 5000, short: 10000, medium: 50000 }
    : { xshort: 4828, short: 9656, medium: 48280 }; // 3mi, 6mi, 30mi
}

export default function MapScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('MapScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Attribution text from map (updated dynamically)
  const [attribution, setAttribution] = useState('© OpenFreeMap © OpenMapTiles © OpenStreetMap');

  // Get the sync date range from global store
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  // Fetch activities for the current sync range (triggers GlobalDataSync)
  const {
    isLoading: isLoadingActivities,
    isError: isActivitiesError,
    refetch: refetchActivities,
  } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    includeStats: false,
    enabled: isAuthenticated,
  });

  // Get sync state from engine cache
  const { isReady, progress, cacheStats } = useActivityBoundsCache();
  const oldestSyncedDate = cacheStats.oldestDate;
  const newestSyncedDate = cacheStats.newestDate;

  // Filter state
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [distanceFilter, setDistanceFilter] = useState<DistanceKey>('all');

  // Memoize period start date to keep reference stable across renders
  const periodStart = useMemo(() => getPeriodStart(period), [period]);

  // Get ALL activities from engine (date filtering only — sport+distance filtering in JS
  // so we always have full counts for category chips even when some types are deselected)
  const allSelectedTypes = useMemo(() => new Set<string>(), []);
  const { activities: allActivities, availableTypes } = useEngineMapActivities({
    startDate: periodStart,
    endDate: ALL_TIME_END,
    selectedTypes: allSelectedTypes,
    enabled: isReady,
  });

  // Apply sport type + distance filters JS-side
  const displayActivities = useMemo(() => {
    let result = allActivities;
    // Sport type filter
    if (selectedTypes.size > 0 && selectedTypes.size < availableTypes.length) {
      result = result.filter((a) => selectedTypes.has(a.type));
    }
    // Distance filter
    if (distanceFilter !== 'all') {
      const thresholds = getDistanceThresholds(isMetric);
      result = result.filter((a) => {
        if (distanceFilter === 'xshort') return a.distance < thresholds.xshort;
        if (distanceFilter === 'short')
          return a.distance >= thresholds.xshort && a.distance < thresholds.short;
        if (distanceFilter === 'medium')
          return a.distance >= thresholds.short && a.distance < thresholds.medium;
        return a.distance >= thresholds.medium;
      });
    }
    return result;
  }, [allActivities, selectedTypes, availableTypes.length, distanceFilter]);

  // Initialize selected types when data loads
  useEffect(() => {
    if (availableTypes.length > 0 && selectedTypes.size === 0) {
      setSelectedTypes(new Set(availableTypes));
    }
  }, [availableTypes]);

  const router = useRouter();

  // Format synced date range for display
  const dateRangeLabel = useMemo(() => {
    if (!oldestSyncedDate || !newestSyncedDate) return '';
    const fmt = (d: string) => {
      const date = new Date(d);
      return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    };
    return `${fmt(oldestSyncedDate)} – ${fmt(newestSyncedDate)}`;
  }, [oldestSyncedDate, newestSyncedDate]);

  // Group available types by category, count from ALL activities (not filtered by sport type)
  // so counts stay stable when toggling chips — chips never move position
  const categorySorted = useMemo(() => {
    const groups = groupTypesByCategory(availableTypes);
    const counts = new Map<string, number>();
    for (const activity of allActivities) {
      const category = Object.entries(ACTIVITY_CATEGORIES).find(([, c]) =>
        c.types.includes(activity.type)
      )?.[0];
      if (category) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return Array.from(groups.entries())
      .map(([category, types]) => ({
        category,
        types,
        count: counts.get(category) ?? 0,
        active: types.every((t) => selectedTypes.has(t)),
      }))
      .sort((a, b) => b.count - a.count);
  }, [availableTypes, allActivities, selectedTypes]);

  // Toggle all types in a category
  const toggleCategory = (category: string) => {
    const group = categorySorted.find((g) => g.category === category);
    const typesInCategory = group?.types ?? [];
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      const allSelected = typesInCategory.every((t) => next.has(t));
      if (allSelected) {
        typesInCategory.forEach((t) => next.delete(t));
      } else {
        typesInCategory.forEach((t) => next.add(t));
      }
      return next;
    });
  };

  // Show error state if activities failed to load
  if (isActivitiesError) {
    return (
      <View
        testID="map-screen"
        style={[styles.loadingContainer, isDark && styles.loadingContainerDark]}
      >
        <ErrorStatePreset onRetry={() => refetchActivities()} />
      </View>
    );
  }

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
          <SyncProgressBanner />
        </View>
      </View>
    );
  }

  return (
    <ScreenErrorBoundary screenName="Map">
      <View style={styles.container} testID="map-screen">
        {/* Main map view */}
        <ComponentErrorBoundary componentName="Map">
          <RegionalMapView
            activities={displayActivities}
            showAttribution={false}
            onAttributionChange={setAttribution}
          />
        </ComponentErrorBoundary>

        {/* Bottom info bar with sport filters */}
        <View
          style={[
            styles.infoBar,
            { paddingBottom: TAB_BAR_SAFE_PADDING + 16 },
            isDark && styles.infoBarDark,
          ]}
        >
          {/* Attribution pill */}
          <View style={[styles.attributionPill, isDark && styles.attributionPillDark]}>
            <Text style={[styles.attributionText, isDark && styles.attributionTextDark]}>
              {attribution}
            </Text>
          </View>

          {/* Time period chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {PERIOD_OPTIONS.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                onPress={() => setPeriod(key)}
                style={[
                  styles.chip,
                  period === key
                    ? styles.chipFilterActive
                    : isDark
                      ? styles.chipDark
                      : styles.chipInactive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    period === key
                      ? styles.chipTextActive
                      : isDark
                        ? styles.chipTextDark
                        : styles.chipTextInactive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Distance chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {getDistanceOptions(isMetric).map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                onPress={() => setDistanceFilter(key)}
                style={[
                  styles.chip,
                  distanceFilter === key
                    ? styles.chipFilterActive
                    : isDark
                      ? styles.chipDark
                      : styles.chipInactive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    distanceFilter === key
                      ? styles.chipTextActive
                      : isDark
                        ? styles.chipTextDark
                        : styles.chipTextInactive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Sport type filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {categorySorted.map(({ category, count, active }) => {
              const config = ACTIVITY_CATEGORIES[category];
              if (!config) return null;
              return (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.chip,
                    active
                      ? { backgroundColor: config.color }
                      : isDark
                        ? styles.chipDark
                        : styles.chipInactive,
                  ]}
                  onPress={() => toggleCategory(category)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      active
                        ? styles.chipTextActive
                        : isDark
                          ? styles.chipTextDark
                          : styles.chipTextInactive,
                    ]}
                  >
                    {t(`maps.activityTypes.${config.labelKey}`, category)}
                    <Text
                      style={[
                        styles.chipCount,
                        active
                          ? styles.chipCountActive
                          : isDark
                            ? styles.chipCountDark
                            : styles.chipCountInactive,
                      ]}
                    >
                      {' '}
                      {count}
                    </Text>
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Activity count and date range */}
          <View style={styles.infoRow}>
            <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
              {displayActivities.length} {t('mapScreen.activities', 'activities')}
              {dateRangeLabel ? ` · ${dateRangeLabel}` : ''}
            </Text>
            <TouchableOpacity onPress={() => router.push('/cache-settings' as never)}>
              <Text style={styles.infoLink}>{t('mapScreen.expandRange', 'Expand range')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ScreenErrorBoundary>
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
  infoBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  infoBarDark: {
    backgroundColor: 'rgba(20, 20, 22, 0.92)',
  },
  chipFilterActive: {
    backgroundColor: colors.primary,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  chipInactive: {
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  chipDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  chipTextInactive: {
    color: colors.textSecondary,
  },
  chipTextDark: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  chipCount: {
    fontSize: 12,
    fontWeight: '400',
  },
  chipCountActive: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  chipCountInactive: {
    color: 'rgba(0, 0, 0, 0.35)',
  },
  chipCountDark: {
    color: 'rgba(255, 255, 255, 0.45)',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  infoTextDark: {
    color: darkColors.textSecondary,
  },
  infoLink: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
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
