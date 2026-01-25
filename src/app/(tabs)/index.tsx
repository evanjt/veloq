import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { Text } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  useInfiniteActivities,
  useAthlete,
  useWellness,
  useTheme,
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  getLatestFTP,
  useSportSettings,
  getSettingsForSport,
  usePaceCurve,
} from '@/hooks';
import type { Activity } from '@/types';
import { useSportPreference, SPORT_COLORS, useDashboardPreferences } from '@/providers';
import type { MetricId } from '@/providers';
import { formatPaceCompact, formatSwimPace } from '@/lib';
import { ActivityCard } from '@/components/activity/ActivityCard';
import { ActivityCardSkeleton, NetworkErrorState, ErrorStatePreset } from '@/components/ui';
import { SummaryCard } from '@/components/home';
import { useScrollVisibilitySafe } from '@/providers';
import { useNetwork } from '@/providers';
import { colors, darkColors, opacity, spacing, layout, typography, shadows } from '@/theme';
import { createSharedStyles } from '@/styles';

// Activity type categories for filtering
const ACTIVITY_TYPE_GROUPS = {
  Cycling: ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide'],
  Running: ['Run', 'VirtualRun', 'TrailRun'],
  Swimming: ['Swim'],
  Other: [
    'Walk',
    'Hike',
    'Workout',
    'WeightTraining',
    'Yoga',
    'Rowing',
    'Elliptical',
    'Ski',
    'Snowboard',
  ],
};

const ALL_TYPES = Object.values(ACTIVITY_TYPE_GROUPS).flat();

export default function FeedScreen() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTypeGroup, setSelectedTypeGroup] = useState<string | null>(null);

  const { data: athlete } = useAthlete();
  const { primarySport } = useSportPreference();
  const { data: sportSettings } = useSportSettings();
  const { isOnline } = useNetwork();
  const { onScroll: onScrollForMenu } = useScrollVisibilitySafe();

  // Dashboard preferences for summary card
  const { summaryCard } = useDashboardPreferences();

  // Fetch pace curve for running threshold pace (only when running is selected)
  const { data: runPaceCurve } = usePaceCurve({
    sport: 'Run',
    enabled: primarySport === 'Running',
  });

  // Profile URL for SummaryCard
  const profileUrl = athlete?.profile_medium || athlete?.profile;

  const {
    data,
    isLoading,
    isError,
    error,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteActivities();

  // Flatten all pages into a single array
  const allActivities = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flat();
  }, [data?.pages]);

  // Filter activities by search query and type
  const filteredActivities = useMemo(() => {
    let filtered = allActivities;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        (activity: Activity) =>
          activity.name?.toLowerCase().includes(query) ||
          activity.type?.toLowerCase().includes(query) ||
          activity.locality?.toLowerCase().includes(query) ||
          activity.country?.toLowerCase().includes(query)
      );
    }

    // Filter by activity type group
    if (selectedTypeGroup) {
      const types =
        ACTIVITY_TYPE_GROUPS[selectedTypeGroup as keyof typeof ACTIVITY_TYPE_GROUPS] || [];
      filtered = filtered.filter((activity: Activity) => types.includes(activity.type));
    }

    return filtered;
  }, [allActivities, searchQuery, selectedTypeGroup]);

  // Fetch wellness data for the summary card (short range for quick load)
  const { data: wellnessData, refetch: refetchWellness } = useWellness('1m');

  // Combined refresh handler - fetches fresh data
  const handleRefresh = async () => {
    await Promise.all([refetch(), refetchWellness()]);
  };

  // Load more when scrolling to the end
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Compute quick stats from wellness and activities data
  // Optimized: Single-pass over activities for all weekly/FTP stats
  const quickStats = useMemo(() => {
    // Get latest wellness data for form and HRV
    const sorted = wellnessData ? [...wellnessData].sort((a, b) => b.id.localeCompare(a.id)) : [];
    const latest = sorted[0];
    const previous = sorted[1]; // Yesterday for trend comparison

    const fitness = Math.round(latest?.ctl ?? latest?.ctlLoad ?? 0);
    const fatigue = Math.round(latest?.atl ?? latest?.atlLoad ?? 0);
    const form = fitness - fatigue;
    const hrv = latest?.hrv ?? null;
    const rhr = latest?.restingHR ?? null;

    // Calculate previous day's values for trends
    const prevFitness = Math.round(previous?.ctl ?? previous?.ctlLoad ?? fitness);
    const prevFatigue = Math.round(previous?.atl ?? previous?.atlLoad ?? fatigue);
    const prevForm = prevFitness - prevFatigue;
    const prevHrv = previous?.hrv ?? hrv;
    const prevRhr = previous?.restingHR ?? rhr;

    const getTrend = (
      current: number | null,
      prev: number | null,
      threshold = 1
    ): '↑' | '↓' | '' => {
      if (current === null || prev === null) return '';
      const diff = current - prev;
      if (Math.abs(diff) < threshold) return '';
      return diff > 0 ? '↑' : '↓';
    };

    const fitnessTrend = getTrend(fitness, prevFitness, 1);
    const formTrend = getTrend(form, prevForm, 2);
    const hrvTrend = getTrend(hrv, prevHrv, 2);
    const rhrTrend = getTrend(rhr, prevRhr, 1);

    // Pre-compute date boundaries once (avoid creating Date objects in loop)
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const weekAgoTs = now - weekMs;
    const twoWeeksAgoTs = now - weekMs * 2;
    const thirtyDaysAgoTs = now - 30 * 24 * 60 * 60 * 1000;

    // Single-pass: Compute all activity-based metrics in one loop
    let weekCount = 0;
    let weekSeconds = 0;
    let prevWeekCount = 0;
    let prevWeekSeconds = 0;
    let latestFtp: number | null = null;
    let latestFtpDate = 0;
    let prevFtp: number | null = null;
    let prevFtpDate = 0;

    if (allActivities) {
      for (const activity of allActivities) {
        const activityTs = new Date(activity.start_date_local).getTime();

        // Current week stats
        if (activityTs >= weekAgoTs) {
          weekCount++;
          weekSeconds += activity.moving_time || 0;
        }
        // Previous week stats
        else if (activityTs >= twoWeeksAgoTs) {
          prevWeekCount++;
          prevWeekSeconds += activity.moving_time || 0;
        }

        // Track FTP values
        if (activity.icu_ftp) {
          // Latest FTP (most recent)
          if (activityTs > latestFtpDate) {
            latestFtpDate = activityTs;
            latestFtp = activity.icu_ftp;
          }
          // Previous FTP (~30 days ago) - most recent before threshold
          if (activityTs <= thirtyDaysAgoTs && activityTs > prevFtpDate) {
            prevFtpDate = activityTs;
            prevFtp = activity.icu_ftp;
          }
        }
      }
    }

    const weekHours = Math.round((weekSeconds / 3600) * 10) / 10;
    const prevWeekHours = Math.round((prevWeekSeconds / 3600) * 10) / 10;

    const weekHoursTrend = getTrend(weekHours, prevWeekHours, 0.5);
    const weekCountTrend = getTrend(weekCount, prevWeekCount, 1);

    // Use latest FTP, fallback to getLatestFTP for edge cases
    const ftp = latestFtp ?? getLatestFTP(allActivities) ?? null;
    const ftpTrend = getTrend(ftp, prevFtp ?? ftp, 3);

    return {
      fitness,
      fitnessTrend,
      form,
      formTrend,
      hrv,
      hrvTrend,
      rhr,
      rhrTrend,
      weekHours,
      weekHoursTrend,
      weekCount,
      weekCountTrend,
      ftp,
      ftpTrend,
    };
  }, [wellnessData, allActivities]);

  const formZone = getFormZone(quickStats.form);
  const formColor = formZone ? FORM_ZONE_COLORS[formZone] : colors.success;

  // Build hero metric data based on summaryCard preferences
  const heroData = useMemo(() => {
    const metric = summaryCard.heroMetric;

    // Get metric value, label, color, and trend based on hero metric type
    switch (metric) {
      case 'form':
        return {
          value: quickStats.form,
          label: t('metrics.form'),
          color: formColor,
          zoneLabel: formZone ? FORM_ZONE_LABELS[formZone] : undefined,
          zoneColor: formColor,
          trend: quickStats.formTrend,
        };
      case 'fitness':
        return {
          value: quickStats.fitness,
          label: t('metrics.fitness'),
          color: colors.fitnessBlue,
          zoneLabel: undefined,
          zoneColor: undefined,
          trend: quickStats.fitnessTrend,
        };
      case 'hrv':
        return {
          value: quickStats.hrv ?? '-',
          label: t('metrics.hrv'),
          color: colors.chartPink,
          zoneLabel: undefined,
          zoneColor: undefined,
          trend: quickStats.hrvTrend,
        };
      default:
        return {
          value: quickStats.form,
          label: t('metrics.form'),
          color: formColor,
          zoneLabel: formZone ? FORM_ZONE_LABELS[formZone] : undefined,
          zoneColor: formColor,
          trend: quickStats.formTrend,
        };
    }
  }, [summaryCard.heroMetric, quickStats, formColor, formZone, t]);

  // Build sparkline data from wellness (last 7 days)
  const sparklineData = useMemo(() => {
    if (!wellnessData || wellnessData.length === 0) return undefined;

    // Sort by date ascending for sparkline
    const sorted = [...wellnessData].sort((a, b) => a.id.localeCompare(b.id)).slice(-30);

    switch (summaryCard.heroMetric) {
      case 'form':
        return sorted.map((w) => {
          const ctl = w.ctl ?? w.ctlLoad ?? 0;
          const atl = w.atl ?? w.atlLoad ?? 0;
          return ctl - atl;
        });
      case 'fitness':
        return sorted.map((w) => w.ctl ?? w.ctlLoad ?? 0);
      case 'hrv':
        return sorted.map((w) => w.hrv ?? 0);
      default:
        return undefined;
    }
  }, [wellnessData, summaryCard.heroMetric]);

  // Get sport-specific metrics from sport settings and pace curve
  const sportMetrics = useMemo(() => {
    const runSettings = getSettingsForSport(sportSettings, 'Run');
    const swimSettings = getSettingsForSport(sportSettings, 'Swim');

    // For running, use criticalSpeed from pace curve (threshold pace equivalent)
    // criticalSpeed is in m/s, same as CSS
    const thresholdPace = runPaceCurve?.criticalSpeed ?? null;

    return {
      // Running threshold metrics
      thresholdPace, // m/s
      runLthr: runSettings?.lthr ?? null, // Lactate Threshold HR
      // Swimming CSS (Critical Swim Speed)
      css: swimSettings?.threshold_pace ?? null, // m/s
    };
  }, [sportSettings, runPaceCurve]);

  // Build supporting metrics array from preferences
  const supportingMetrics = useMemo(() => {
    return summaryCard.supportingMetrics.slice(0, 4).map((metricId: MetricId) => {
      switch (metricId) {
        case 'fitness':
          return {
            label: t('metrics.fitness'),
            value: quickStats.fitness,
            color: colors.fitnessBlue,
            trend: quickStats.fitnessTrend,
          };
        case 'form':
          return {
            label: t('metrics.form'),
            value: quickStats.form > 0 ? `+${quickStats.form}` : quickStats.form,
            color: formColor,
            trend: quickStats.formTrend,
          };
        case 'hrv':
          return {
            label: t('metrics.hrv'),
            value: quickStats.hrv ?? '-',
            color: colors.chartPink,
            trend: quickStats.hrvTrend,
          };
        case 'rhr':
          return {
            label: t('metrics.rhr'),
            value: quickStats.rhr ?? '-',
            color: undefined,
            trend: quickStats.rhrTrend,
          };
        case 'ftp':
          return {
            label: t('metrics.ftp'),
            value: quickStats.ftp ?? '-',
            color: SPORT_COLORS.Cycling,
            trend: quickStats.ftpTrend,
          };
        case 'thresholdPace':
          return {
            label: t('metrics.pace'),
            value: sportMetrics.thresholdPace ? formatPaceCompact(sportMetrics.thresholdPace) : '-',
            color: SPORT_COLORS.Running,
            trend: undefined,
          };
        case 'css':
          return {
            label: t('metrics.css'),
            value: sportMetrics.css ? formatSwimPace(sportMetrics.css) : '-',
            color: SPORT_COLORS.Swimming,
            trend: undefined,
          };
        case 'weekHours':
          return {
            label: t('metrics.week'),
            value: `${quickStats.weekHours}h`,
            color: undefined,
            trend: quickStats.weekHoursTrend,
          };
        case 'weekCount':
          return {
            label: '#',
            value: quickStats.weekCount,
            color: undefined,
            trend: quickStats.weekCountTrend,
          };
        default:
          return {
            label: metricId,
            value: '-',
            color: undefined,
            trend: undefined,
          };
      }
    });
  }, [summaryCard.supportingMetrics, quickStats, formColor, sportMetrics, t]);

  const renderActivity = ({ item }: { item: Activity }) => <ActivityCard activity={item} />;

  const navigateToSettings = () => router.push('/settings' as Href);

  const toggleFilters = () => setShowFilters(!showFilters);

  const selectTypeGroup = (group: string | null) => {
    setSelectedTypeGroup(selectedTypeGroup === group ? null : group);
  };

  // Memoized section header for FlatList - only depends on filtered count
  const renderListHeader = useCallback(
    () => (
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
          {searchQuery || selectedTypeGroup
            ? t('feed.activitiesCount', { count: filteredActivities.length })
            : t('feed.recentActivities')}
        </Text>
      </View>
    ),
    [isDark, searchQuery, selectedTypeGroup, filteredActivities.length, t]
  );

  const renderEmpty = () => (
    <View testID="home-empty-state" style={styles.emptyContainer}>
      <Text style={[styles.emptyText, isDark && styles.textLight]}>
        {searchQuery || selectedTypeGroup ? t('feed.noMatchingActivities') : t('feed.noActivities')}
      </Text>
    </View>
  );

  const renderError = () => {
    // Check if this is a network error (axios error codes)
    const axiosError = error as { code?: string };
    const isNetworkError =
      axiosError?.code === 'ERR_NETWORK' ||
      axiosError?.code === 'ECONNABORTED' ||
      axiosError?.code === 'ETIMEDOUT';

    if (isNetworkError) {
      return <NetworkErrorState onRetry={() => refetch()} />;
    }

    return (
      <ErrorStatePreset
        message={error instanceof Error ? error.message : t('feed.failedToLoad')}
        onRetry={() => refetch()}
      />
    );
  };

  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.footerText, isDark && styles.textDark]}>
          {t('common.loadingMore')}
        </Text>
      </View>
    );
  };

  if (isLoading && !allActivities.length) {
    return (
      <ScreenSafeAreaView style={shared.container}>
        <View style={styles.skeletonContainer}>
          {/* Summary card skeleton */}
          <View style={[styles.summaryCardSkeleton, isDark && styles.summaryCardSkeletonDark]}>
            <View style={styles.skeletonRow}>
              <View style={[styles.skeletonCircle, isDark && styles.skeletonElementDark]} />
              <View style={styles.skeletonSpacer} />
            </View>
            <View style={styles.skeletonHero}>
              <View style={[styles.skeletonHeroValue, isDark && styles.skeletonElementDark]} />
              <View style={[styles.skeletonHeroLabel, isDark && styles.skeletonElementDark]} />
            </View>
            <View style={styles.skeletonMetrics}>
              <View style={[styles.skeletonMetric, isDark && styles.skeletonElementDark]} />
              <View style={[styles.skeletonMetric, isDark && styles.skeletonElementDark]} />
              <View style={[styles.skeletonMetric, isDark && styles.skeletonElementDark]} />
            </View>
          </View>
          {/* Section header skeleton */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              {t('feed.recentActivities')}
            </Text>
          </View>
          {/* Activity card skeletons */}
          <ActivityCardSkeleton />
          <ActivityCardSkeleton />
          <ActivityCardSkeleton />
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenSafeAreaView style={shared.container} testID="home-screen">
      {/* Summary card with hero metric and supporting stats */}
      <SummaryCard
        profileUrl={profileUrl}
        onProfilePress={navigateToSettings}
        heroValue={heroData.value}
        heroLabel={heroData.label}
        heroColor={heroData.color}
        heroZoneLabel={heroData.zoneLabel}
        heroZoneColor={heroData.zoneColor}
        heroTrend={heroData.trend}
        sparklineData={sparklineData}
        showSparkline={summaryCard.showSparkline}
        supportingMetrics={supportingMetrics}
      />

      {/* Search and Filter bar - outside FlatList to preserve focus */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, isDark && styles.searchBarDark]}>
          <MaterialCommunityIcons name="magnify" size={20} color={themeColors.textSecondary} />
          <TextInput
            testID="home-search-input"
            style={[styles.searchInput, isDark && styles.searchInputDark]}
            placeholder={t('feed.searchPlaceholder')}
            placeholderTextColor={themeColors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={Keyboard.dismiss}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            // iOS-specific keyboard optimizations
            keyboardAppearance={isDark ? 'dark' : 'light'}
            enablesReturnKeyAutomatically={Platform.OS === 'ios'}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              accessibilityLabel={t('common.clearSearch')}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="close-circle" size={18} color={themeColors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          testID="home-filter-button"
          style={[
            styles.filterButton,
            isDark && styles.filterButtonDark,
            (showFilters || selectedTypeGroup) && styles.filterButtonActive,
          ]}
          onPress={toggleFilters}
          accessibilityLabel={showFilters ? t('filters.hideFilters') : t('filters.showFilters')}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="filter-variant"
            size={20}
            color={showFilters || selectedTypeGroup ? colors.textOnDark : themeColors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Filter chips - outside FlatList */}
      {showFilters && (
        <View style={styles.filterChips}>
          {Object.keys(ACTIVITY_TYPE_GROUPS).map((group) => (
            <TouchableOpacity
              key={group}
              style={[
                styles.filterChip,
                isDark && styles.filterChipDark,
                selectedTypeGroup === group && styles.filterChipActive,
              ]}
              onPress={() => selectTypeGroup(group)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  isDark && styles.filterChipTextDark,
                  selectedTypeGroup === group && styles.filterChipTextActive,
                ]}
              >
                {group}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        testID="home-activity-list"
        data={filteredActivities}
        renderItem={renderActivity}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={isError ? renderError : renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={isOnline ? handleRefresh : undefined}
            enabled={isOnline}
            colors={[colors.primary]}
            tintColor={colors.primary}
            progressBackgroundColor={isDark ? darkColors.surface : colors.surface}
            title={Platform.OS === 'ios' ? t('common.pullToRefresh') : undefined}
            titleColor={Platform.OS === 'ios' ? themeColors.textSecondary : undefined}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
        // Scroll handler for floating menu visibility
        onScroll={onScrollForMenu}
        scrollEventThrottle={16}
        // iOS scroll performance optimizations
        removeClippedSubviews={Platform.OS === 'ios'}
        maxToRenderPerBatch={Platform.OS === 'ios' ? 15 : 10}
        windowSize={Platform.OS === 'ios' ? 21 : 11}
        initialNumToRender={10}
      />
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Summary card skeleton styles
  summaryCardSkeleton: {
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  summaryCardSkeletonDark: {
    backgroundColor: darkColors.surface,
    ...shadows.none,
    borderWidth: 1,
    borderColor: darkColors.border,
  },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  skeletonCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.divider,
  },
  skeletonSpacer: {
    flex: 1,
  },
  skeletonHero: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  skeletonHeroValue: {
    width: 60,
    height: 32,
    borderRadius: 4,
    backgroundColor: colors.divider,
    marginBottom: spacing.xs,
  },
  skeletonHeroLabel: {
    width: 40,
    height: 14,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  skeletonMetrics: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.lg,
  },
  skeletonMetric: {
    width: 50,
    height: 14,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  skeletonElementDark: {
    backgroundColor: darkColors.border,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: opacity.overlay.light,
    borderRadius: 10,
    paddingHorizontal: layout.cardMargin,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchBarDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchInputDark: {
    color: colors.textOnDark,
  },
  filterButton: {
    width: 44, // Accessibility minimum
    height: 44, // Accessibility minimum
    borderRadius: 10,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: spacing.md,
    backgroundColor: opacity.overlay.light,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  filterChipTextDark: {
    color: darkColors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.textOnDark,
  },
  sectionHeader: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  skeletonContainer: {
    flex: 1,
    paddingHorizontal: layout.screenPadding,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: 8,
  },
  footerText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
});
