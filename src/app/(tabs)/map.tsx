import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  FILTER_CHIP,
  DEFAULT_MAP_PERIOD,
  getPeriodStart,
  MapNameSearch,
  type MapPeriod,
  PERIOD_OPTIONS,
  RegionalMapView,
  SyncProgressBanner,
  useEngineMapActivities,
  useHeatmapPreference,
} from '@/features/maps';
import {
  ComponentErrorBoundary,
  ErrorStatePreset,
  TAB_BAR_SAFE_PADDING,
  Shimmer,
  pressable,
  pressRipple,
} from '@/shared/ui';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { useActivityBoundsCache, useActivities } from '@/features/activity';
import { useRouteSettings } from '@/features/routes';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { MapDistanceBand } from 'veloqrs';
import { colors, darkColors, ink, spacing, typography, layout, colorWithOpacity } from '@/theme';
import { SportChipRow } from '@/shared/ui/SportChipRow';
import { ACTIVITY_CATEGORIES, groupTypesByCategory } from '@/shared/activity/sportCategories';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { formatMonthYear } from '@/shared/format/format';

// Stable date references - creating new Date() in the component body triggers
// useEngineMapActivities useMemo on every render, causing cascading re-renders
// that make Android MapLibre snap the camera back.
const ALL_TIME_END = new Date('2099-12-31');

const MAX_SEARCH_RESULTS = 5;

// Distance thresholds in meters (metric) and labels for both systems
function getDistanceOptions(
  isMetric: boolean,
  anyLabel: string
): { key: MapDistanceBand; label: string }[] {
  return isMetric
    ? [
        { key: MapDistanceBand.All, label: anyLabel },
        { key: MapDistanceBand.XShort, label: '<5km' },
        { key: MapDistanceBand.Short, label: '5–10km' },
        { key: MapDistanceBand.Medium, label: '10–50km' },
        { key: MapDistanceBand.Long, label: '50km+' },
      ]
    : [
        { key: MapDistanceBand.All, label: anyLabel },
        { key: MapDistanceBand.XShort, label: '<3mi' },
        { key: MapDistanceBand.Short, label: '3–6mi' },
        { key: MapDistanceBand.Medium, label: '6–30mi' },
        { key: MapDistanceBand.Long, label: '30mi+' },
      ];
}

function MapScreenContent() {
  useTabFirstFrame('/map');
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
  const { isError: isActivitiesError, refetch: refetchActivities } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    enabled: isAuthenticated,
  });

  // Get sync state from engine cache
  const { isReady, cacheStats } = useActivityBoundsCache();
  const oldestSyncedDate = cacheStats.oldestDate;
  const newestSyncedDate = cacheStats.newestDate;

  // Filter state
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<MapPeriod>(DEFAULT_MAP_PERIOD);
  const [distanceFilter, setDistanceFilter] = useState<MapDistanceBand>(MapDistanceBand.All);
  const [nameNeedle, setNameNeedle] = useState('');
  const [focusActivityId, setFocusActivityId] = useState<string | undefined>(undefined);
  const [resultsOpen, setResultsOpen] = useState(false);

  // Memoize period start date to keep reference stable across renders
  const periodStart = useMemo(() => getPeriodStart(period), [period]);

  const showRoutes = useHeatmapPreference((s) => s.routesVisible);
  const showSections = useHeatmapPreference((s) => s.sectionsVisible);
  const sectionsEnabled = useRouteSettings((s) => s.settings.enabled);

  const selectedTypes = useMemo(
    () =>
      new Set(
        [...selectedCategories].flatMap((category) => ACTIVITY_CATEGORIES[category]?.types ?? [])
      ),
    [selectedCategories]
  );

  const {
    activities: displayActivities,
    availableTypes,
    categoryCounts,
    totalCount,
    routeCount,
    routeLines,
    sectionCount,
    sections,
  } = useEngineMapActivities({
    startDate: periodStart,
    endDate: ALL_TIME_END,
    selectedTypes,
    distanceBand: distanceFilter,
    isMetric,
    nameNeedle,
    showRoutes,
    showSections,
    sectionsEnabled,
    enabled: isReady,
  });

  const router = useRouter();
  const { activity: selectActivityId, section: selectSectionId } = useLocalSearchParams<{
    activity?: string;
    section?: string;
  }>();

  // Format synced date range for display
  const dateRangeLabel = useMemo(() => {
    if (!oldestSyncedDate || !newestSyncedDate) return '';
    return `${formatMonthYear(oldestSyncedDate)} – ${formatMonthYear(newestSyncedDate)}`;
  }, [oldestSyncedDate, newestSyncedDate]);

  // The engine counts chips before sport and distance filters, so they stay put.
  const categorySorted = useMemo(() => {
    const groups = groupTypesByCategory(availableTypes);
    const counts = new Map(categoryCounts.map(({ category, count }) => [category, count]));
    return Array.from(groups.entries())
      .map(([category]) => ({
        category,
        count: counts.get(category) ?? 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [availableTypes, categoryCounts]);

  const changeNeedle = (text: string) => {
    setNameNeedle(text);
    setFocusActivityId(undefined);
    setResultsOpen(text.trim().length > 0);
  };

  const chooseResult = (id: string) => {
    setResultsOpen(false);
    setFocusActivityId(id);
  };

  const results = resultsOpen ? displayActivities.slice(0, MAX_SEARCH_RESULTS) : [];

  const toggleCategory = (category: string) => {
    setSelectedCategories((previous) => {
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
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
        <Shimmer width="100%" height={220} style={styles.loadingShimmer} />
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
    <View style={styles.container} testID="map-screen">
      {/* Main map view */}
      <ComponentErrorBoundary componentName="Map">
        <RegionalMapView
          activities={displayActivities}
          routeCount={routeCount}
          routeLines={routeLines}
          sectionCount={sectionCount}
          sections={sections}
          onAttributionChange={setAttribution}
          selectActivityId={selectActivityId}
          focusActivityId={focusActivityId}
          sectionsEnabled={sectionsEnabled}
          selectSectionId={sectionsEnabled ? selectSectionId : undefined}
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

        <MapNameSearch
          needle={nameNeedle}
          onChangeNeedle={changeNeedle}
          results={results}
          onChoose={chooseResult}
        />

        {/* Time period chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {PERIOD_OPTIONS.map(({ id: key, labelKey }) => (
            <Pressable
              key={key}
              onPress={() => setPeriod(key)}
              style={pressable([
                styles.chip,
                period === key
                  ? styles.chipFilterActive
                  : isDark
                    ? styles.chipDark
                    : styles.chipInactive,
              ])}
              android_ripple={pressRipple}
            >
              <Text
                style={[
                  styles.chipText,
                  period === key
                    ? styles.chipTextFilterActive
                    : isDark
                      ? styles.chipTextDark
                      : styles.chipTextInactive,
                ]}
              >
                {t(labelKey as never)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Distance chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {getDistanceOptions(isMetric, t('mapScreen.distanceAny')).map(({ key, label }) => (
            <Pressable
              key={key}
              onPress={() => setDistanceFilter(key)}
              style={pressable([
                styles.chip,
                distanceFilter === key
                  ? styles.chipFilterActive
                  : isDark
                    ? styles.chipDark
                    : styles.chipInactive,
              ])}
              android_ripple={pressRipple}
            >
              <Text
                style={[
                  styles.chipText,
                  distanceFilter === key
                    ? styles.chipTextFilterActive
                    : isDark
                      ? styles.chipTextDark
                      : styles.chipTextInactive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Sport type filter chips */}
        <SportChipRow
          chips={categorySorted.map(({ category, count }) => ({
            key: category,
            label: `maps.activityTypes.${ACTIVITY_CATEGORIES[category]?.labelKey ?? 'other'}`,
            count,
          }))}
          selected={selectedCategories}
          onToggle={toggleCategory}
          isDark={isDark}
        />

        {/* Activity count and date range */}
        <View style={styles.infoRow}>
          <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
            {t('mapScreen.activitySummary', {
              count: totalCount,
              mapped: displayActivities.length,
              defaultValue: '{{count}} activities · {{mapped}} on the map',
            })}
            {dateRangeLabel ? ` · ${dateRangeLabel}` : ''}
          </Text>
          <Pressable
            onPress={() => router.push('/sync-settings' as never)}
            style={pressable()}
            android_ripple={pressRipple}
          >
            <Text style={[styles.infoLink, isDark && { color: darkColors.linkTeal }]}>
              {t('mapScreen.expandRange', 'Expand range')}
            </Text>
          </Pressable>
        </View>
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
  loadingShimmer: {
    alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
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
    backgroundColor: colorWithOpacity(ink.white, 0.92),
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  infoBarDark: {
    backgroundColor: colorWithOpacity(darkColors.backgroundAlt, 0.92),
  },
  chipFilterActive: {
    backgroundColor: FILTER_CHIP.fill,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
  },
  chipInactive: {
    backgroundColor: colorWithOpacity(ink.black, 0.08),
  },
  chipDark: {
    backgroundColor: colorWithOpacity(ink.white, 0.15),
  },
  chipTextFilterActive: {
    color: FILTER_CHIP.ink,
  },
  chipText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
  },
  chipTextInactive: {
    color: colors.textSecondary,
  },
  chipTextDark: {
    color: colorWithOpacity(ink.white, 0.8),
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  infoText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  infoTextDark: {
    color: darkColors.textSecondary,
  },
  infoLink: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.linkTeal,
    fontWeight: '600',
  },
  attributionPill: {
    position: 'absolute',
    top: -19,
    right: 0,
    backgroundColor: colorWithOpacity(ink.white, 0.8),
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderTopLeftRadius: layout.borderRadiusSm,
    zIndex: 1,
  },
  attributionPillDark: {
    backgroundColor: colorWithOpacity(darkColors.surfaceElevated, 0.8),
  },
  attributionText: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  attributionTextDark: {
    color: darkColors.textSecondary,
  },
});

export default withScreenBoundary(MapScreenContent, 'Map');
