import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  useColorScheme,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useInfiniteActivities, useAthlete, useWellness, getFormZone, FORM_ZONE_COLORS, getLatestFTP, useSportSettings, getSettingsForSport, usePaceCurve } from '@/hooks';
import { useSportPreference, SPORT_COLORS } from '@/providers';
import { formatPaceCompact, formatSwimPace } from '@/lib';
import { ActivityCard } from '@/components/activity/ActivityCard';
import { ActivityCardSkeleton, StatsPillSkeleton, MapFAB } from '@/components/ui';
import { colors, spacing, layout, typography } from '@/theme';
import type { Activity } from '@/types';

// Activity type categories for filtering
const ACTIVITY_TYPE_GROUPS = {
  Cycling: ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide'],
  Running: ['Run', 'VirtualRun', 'TrailRun'],
  Swimming: ['Swim'],
  Other: ['Walk', 'Hike', 'Workout', 'WeightTraining', 'Yoga', 'Rowing', 'Elliptical', 'Ski', 'Snowboard'],
};

const ALL_TYPES = Object.values(ACTIVITY_TYPE_GROUPS).flat();

export default function FeedScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [profileImageError, setProfileImageError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTypeGroup, setSelectedTypeGroup] = useState<string | null>(null);

  const { data: athlete } = useAthlete();
  const { primarySport } = useSportPreference();
  const { data: sportSettings } = useSportSettings();

  // Fetch pace curve for running threshold pace (only when running is selected)
  const { data: runPaceCurve } = usePaceCurve({
    sport: 'Run',
    enabled: primarySport === 'Running'
  });

  // Validate profile URL - must be a non-empty string starting with http
  const profileUrl = athlete?.profile_medium || athlete?.profile;
  const hasValidProfileUrl = profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');

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
      filtered = filtered.filter(activity =>
        activity.name?.toLowerCase().includes(query) ||
        activity.type?.toLowerCase().includes(query) ||
        activity.locality?.toLowerCase().includes(query) ||
        activity.country?.toLowerCase().includes(query)
      );
    }

    // Filter by activity type group
    if (selectedTypeGroup) {
      const types = ACTIVITY_TYPE_GROUPS[selectedTypeGroup as keyof typeof ACTIVITY_TYPE_GROUPS] || [];
      filtered = filtered.filter(activity => types.includes(activity.type));
    }

    return filtered;
  }, [allActivities, searchQuery, selectedTypeGroup]);

  // Fetch wellness data for the header badge (short range for quick load)
  const { data: wellnessData, isLoading: wellnessLoading, refetch: refetchWellness } = useWellness('7d');

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

    const getTrend = (current: number | null, prev: number | null, threshold = 1): '↑' | '↓' | '' => {
      if (current === null || prev === null) return '';
      const diff = current - prev;
      if (Math.abs(diff) < threshold) return '';
      return diff > 0 ? '↑' : '↓';
    };

    const fitnessTrend = getTrend(fitness, prevFitness, 1);
    const formTrend = getTrend(form, prevForm, 2);
    const hrvTrend = getTrend(hrv, prevHrv, 2);
    const rhrTrend = getTrend(rhr, prevRhr, 1);

    // Calculate week totals from activities
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const weekAgo = new Date(now - weekMs);
    const twoWeeksAgo = new Date(now - weekMs * 2);

    // Current week activities
    const weekActivities = allActivities?.filter(a => new Date(a.start_date_local) >= weekAgo) ?? [];
    const weekCount = weekActivities.length;
    const weekSeconds = weekActivities.reduce((sum, a) => sum + (a.moving_time || 0), 0);
    const weekHours = Math.round(weekSeconds / 3600 * 10) / 10;

    // Previous week activities for trend
    const prevWeekActivities = allActivities?.filter(a => {
      const date = new Date(a.start_date_local);
      return date >= twoWeeksAgo && date < weekAgo;
    }) ?? [];
    const prevWeekCount = prevWeekActivities.length;
    const prevWeekSeconds = prevWeekActivities.reduce((sum, a) => sum + (a.moving_time || 0), 0);
    const prevWeekHours = Math.round(prevWeekSeconds / 3600 * 10) / 10;

    const weekHoursTrend = getTrend(weekHours, prevWeekHours, 0.5);
    const weekCountTrend = getTrend(weekCount, prevWeekCount, 1);

    // Get latest FTP from activities with trend
    const ftp = getLatestFTP(allActivities) ?? null;
    // Get FTP from ~30 days ago for trend
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const olderActivitiesWithFtp = allActivities?.filter(a =>
      new Date(a.start_date_local) <= thirtyDaysAgo && a.icu_ftp
    ).sort((a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()) ?? [];
    const prevFtp = olderActivitiesWithFtp[0]?.icu_ftp ?? ftp;
    const ftpTrend = getTrend(ftp, prevFtp, 3);

    return {
      fitness, fitnessTrend,
      form, formTrend,
      hrv, hrvTrend,
      rhr, rhrTrend,
      weekHours, weekHoursTrend,
      weekCount, weekCountTrend,
      ftp, ftpTrend
    };
  }, [wellnessData, allActivities]);

  const formZone = getFormZone(quickStats.form);
  const formColor = formZone ? FORM_ZONE_COLORS[formZone] : colors.success;

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

  const renderActivity = ({ item }: { item: Activity }) => (
    <ActivityCard activity={item} />
  );

  const navigateToFitness = () => router.push('/fitness');
  const navigateToWellness = () => router.push('/wellness');
  const navigateToTraining = () => router.push('/training');
  const navigateToStats = () => router.push('/stats');
  const navigateToMap = () => router.push('/map' as Href);
  const navigateToSettings = () => router.push('/settings' as Href);

  const toggleFilters = () => setShowFilters(!showFilters);

  const selectTypeGroup = (group: string | null) => {
    setSelectedTypeGroup(selectedTypeGroup === group ? null : group);
  };

  const renderHeader = () => (
    <>
      {/* Header with profile and separate stat pills */}
      <View style={styles.header}>
        {/* Profile photo - tap to open settings */}
        <TouchableOpacity
          onPress={navigateToSettings}
          activeOpacity={0.7}
          style={[styles.profilePhoto, styles.profilePlaceholder, isDark && styles.profilePlaceholderDark]}
        >
          {hasValidProfileUrl && !profileImageError ? (
            <Image
              source={{ uri: profileUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setProfileImageError(true)}
            />
          ) : (
            <MaterialCommunityIcons
              name="account"
              size={20}
              color={isDark ? '#AAA' : '#666'}
            />
          )}
        </TouchableOpacity>

        {/* Pill buttons for each page */}
        <View style={styles.pillRow}>
          {/* HRV + RHR → Wellness page */}
          <TouchableOpacity
            style={[styles.pill, isDark && styles.pillDark]}
            onPress={navigateToWellness}
            activeOpacity={0.7}
          >
            <View style={styles.pillItem}>
              <Text style={[styles.pillLabel, isDark && styles.textDark]}>HRV</Text>
              <Text style={[styles.pillValue, { color: '#E91E63' }]}>
                {quickStats.hrv ?? '-'}
                {quickStats.hrvTrend && <Text style={styles.trendArrow}>{quickStats.hrvTrend}</Text>}
              </Text>
            </View>
            {quickStats.rhr && (
              <>
                <Text style={[styles.pillDivider, isDark && styles.pillDividerDark]}>|</Text>
                <View style={styles.pillItem}>
                  <Text style={[styles.pillLabel, isDark && styles.textDark]}>RHR</Text>
                  <Text style={[styles.pillValueSmall, isDark && styles.textDark]}>
                    {quickStats.rhr}
                    {quickStats.rhrTrend && <Text style={styles.trendArrowSmall}>{quickStats.rhrTrend}</Text>}
                  </Text>
                </View>
              </>
            )}
          </TouchableOpacity>

          {/* Week hours + count → Training page */}
          <TouchableOpacity
            style={[styles.pill, isDark && styles.pillDark]}
            onPress={navigateToTraining}
            activeOpacity={0.7}
          >
            <View style={styles.pillItem}>
              <Text style={[styles.pillLabel, isDark && styles.textDark]}>Week</Text>
              <Text style={[styles.pillValue, isDark && styles.textLight]}>
                {quickStats.weekHours}h
                {quickStats.weekHoursTrend && <Text style={styles.trendArrow}>{quickStats.weekHoursTrend}</Text>}
              </Text>
            </View>
            <Text style={[styles.pillDivider, isDark && styles.pillDividerDark]}>|</Text>
            <View style={styles.pillItem}>
              <Text style={[styles.pillLabel, isDark && styles.textDark]}>#</Text>
              <Text style={[styles.pillValueSmall, isDark && styles.textDark]}>
                {quickStats.weekCount}
                {quickStats.weekCountTrend && <Text style={styles.trendArrowSmall}>{quickStats.weekCountTrend}</Text>}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Sport-specific metric → Performance page */}
          <TouchableOpacity
            style={[styles.pill, isDark && styles.pillDark]}
            onPress={navigateToStats}
            activeOpacity={0.7}
          >
            {primarySport === 'Cycling' && (
              <View style={styles.pillItem}>
                <Text style={[styles.pillLabel, isDark && styles.textDark]}>FTP</Text>
                <Text style={[styles.pillValue, { color: SPORT_COLORS.Cycling }]}>
                  {quickStats.ftp ?? '-'}
                  {quickStats.ftpTrend && <Text style={styles.trendArrow}>{quickStats.ftpTrend}</Text>}
                </Text>
              </View>
            )}
            {primarySport === 'Running' && (
              <>
                <View style={styles.pillItem}>
                  <Text style={[styles.pillLabel, isDark && styles.textDark]}>Pace</Text>
                  <Text style={[styles.pillValue, { color: SPORT_COLORS.Running }]}>
                    {sportMetrics.thresholdPace ? formatPaceCompact(sportMetrics.thresholdPace) : '-'}
                  </Text>
                </View>
                {sportMetrics.runLthr && (
                  <>
                    <Text style={[styles.pillDivider, isDark && styles.pillDividerDark]}>|</Text>
                    <View style={styles.pillItem}>
                      <Text style={[styles.pillLabel, isDark && styles.textDark]}>HR</Text>
                      <Text style={[styles.pillValueSmall, isDark && styles.textDark]}>
                        {sportMetrics.runLthr}
                      </Text>
                    </View>
                  </>
                )}
              </>
            )}
            {primarySport === 'Swimming' && (
              <View style={styles.pillItem}>
                <Text style={[styles.pillLabel, isDark && styles.textDark]}>CSS</Text>
                <Text style={[styles.pillValue, { color: SPORT_COLORS.Swimming }]}>
                  {sportMetrics.css ? formatSwimPace(sportMetrics.css) : '-'}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Fitness + Form → Fitness page */}
          <TouchableOpacity
            style={[styles.pill, isDark && styles.pillDark]}
            onPress={navigateToFitness}
            activeOpacity={0.7}
          >
            <View style={styles.pillItem}>
              <Text style={[styles.pillLabel, isDark && styles.textDark]}>Fit</Text>
              <Text style={[styles.pillValue, { color: '#42A5F5' }]}>
                {quickStats.fitness}
                {quickStats.fitnessTrend && <Text style={styles.trendArrow}>{quickStats.fitnessTrend}</Text>}
              </Text>
            </View>
            <Text style={[styles.pillDivider, isDark && styles.pillDividerDark]}>|</Text>
            <View style={styles.pillItem}>
              <Text style={[styles.pillLabel, isDark && styles.textDark]}>Form</Text>
              <Text style={[styles.pillValue, { color: formColor }]}>
                {quickStats.form > 0 ? '+' : ''}{quickStats.form}
                {quickStats.formTrend && <Text style={styles.trendArrow}>{quickStats.formTrend}</Text>}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search and Filter bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, isDark && styles.searchBarDark]}>
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={isDark ? '#888' : colors.textSecondary}
          />
          <TextInput
            style={[styles.searchInput, isDark && styles.searchInputDark]}
            placeholder="Search activities..."
            placeholderTextColor={isDark ? '#666' : '#999'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <MaterialCommunityIcons
                name="close-circle"
                size={18}
                color={isDark ? '#666' : '#999'}
              />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[
            styles.filterButton,
            isDark && styles.filterButtonDark,
            (showFilters || selectedTypeGroup) && styles.filterButtonActive,
          ]}
          onPress={toggleFilters}
        >
          <MaterialCommunityIcons
            name="filter-variant"
            size={20}
            color={(showFilters || selectedTypeGroup) ? '#FFF' : (isDark ? '#AAA' : colors.textSecondary)}
          />
        </TouchableOpacity>
      </View>

      {/* Filter chips */}
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

      {/* Activities section header */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
          {searchQuery || selectedTypeGroup ? `${filteredActivities.length} Activities` : 'Recent Activities'}
        </Text>
      </View>
    </>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={[styles.emptyText, isDark && styles.textLight]}>
        {searchQuery || selectedTypeGroup ? 'No matching activities' : 'No activities found'}
      </Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.errorText}>
        {error instanceof Error ? error.message : 'Failed to load activities'}
      </Text>
    </View>
  );

  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.footerText, isDark && styles.textDark]}>Loading more...</Text>
      </View>
    );
  };

  if (isLoading && !allActivities.length) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.skeletonContainer}>
          {/* Header skeleton */}
          <View style={styles.header}>
            <View style={[styles.profilePhoto, styles.profilePlaceholder, isDark && styles.profilePlaceholderDark]} />
            <StatsPillSkeleton />
          </View>
          {/* Section header skeleton */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Recent Activities</Text>
          </View>
          {/* Activity card skeletons */}
          <ActivityCardSkeleton />
          <ActivityCardSkeleton />
          <ActivityCardSkeleton />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <FlatList
        data={filteredActivities}
        renderItem={renderActivity}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={isError ? renderError : renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
      />
      <MapFAB onPress={navigateToMap} />
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
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
  },
  profilePhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  profilePlaceholder: {
    backgroundColor: '#E8E8E8',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  profilePlaceholderDark: {
    backgroundColor: '#333',
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.04)',
  },
  pillDark: {
    backgroundColor: 'rgba(40, 40, 40, 0.9)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowOpacity: 0,
  },
  pillItem: {
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  pillLabel: {
    fontSize: 8,
    color: colors.textSecondary,
    marginBottom: 1,
  },
  pillValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pillValueSmall: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pillDivider: {
    fontSize: 12,
    color: 'rgba(0, 0, 0, 0.15)',
    marginHorizontal: 4,
  },
  pillDividerDark: {
    color: 'rgba(255, 255, 255, 0.2)',
  },
  trendArrow: {
    fontSize: 10,
    marginLeft: 1,
  },
  trendArrowSmall: {
    fontSize: 8,
    marginLeft: 1,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
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
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchBarDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchInputDark: {
    color: '#FFF',
  },
  filterButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterButtonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  filterChipTextDark: {
    color: '#AAA',
  },
  filterChipTextActive: {
    color: '#FFF',
  },
  sectionHeader: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 14,
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
    fontSize: 14,
    color: colors.textSecondary,
  },
});
