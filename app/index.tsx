import React, { useMemo, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  useColorScheme,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useActivities, useAthlete, useWellness, getFormZone, FORM_ZONE_COLORS } from '@/hooks';
import { ActivityCard } from '@/components/activity/ActivityCard';
import { ActivityCardSkeleton, StatsPillSkeleton } from '@/components/ui';
import { colors, spacing, layout, typography } from '@/theme';
import type { Activity } from '@/types';

export default function FeedScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [profileImageError, setProfileImageError] = useState(false);

  const { data: athlete } = useAthlete();

  // Validate profile URL - must be a non-empty string starting with http
  const profileUrl = athlete?.profile_medium || athlete?.profile;
  const hasValidProfileUrl = profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');
  const {
    data: activities,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useActivities();

  // Fetch wellness data for the header badge (short range for quick load)
  const { data: wellnessData, isLoading: wellnessLoading, refetch: refetchWellness } = useWellness('7d');

  // Combined refresh handler
  const handleRefresh = async () => {
    await Promise.all([refetch(), refetchWellness()]);
  };

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

    // Calculate trends (compare to previous day)
    const prevFitness = Math.round(previous?.ctl ?? previous?.ctlLoad ?? fitness);
    const prevHrv = previous?.hrv ?? hrv;
    const prevRhr = previous?.restingHR ?? rhr;

    const getTrend = (current: number | null, prev: number | null, threshold = 1): '↑' | '↓' | '' => {
      if (current === null || prev === null) return '';
      const diff = current - prev;
      if (Math.abs(diff) < threshold) return '';
      return diff > 0 ? '↑' : '↓';
    };

    const fitnessTrend = getTrend(fitness, prevFitness, 1);
    const hrvTrend = getTrend(hrv, prevHrv, 2);
    const rhrTrend = getTrend(rhr, prevRhr, 1);

    // Calculate week totals from activities
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const weekAgo = new Date(Date.now() - weekMs);
    const weekActivities = activities?.filter(a => new Date(a.start_date_local) >= weekAgo) ?? [];
    const weekCount = weekActivities.length;
    const weekSeconds = weekActivities.reduce((sum, a) => sum + (a.moving_time || 0), 0);
    const weekHours = Math.round(weekSeconds / 3600 * 10) / 10;

    return {
      fitness, fitnessTrend,
      form,
      hrv, hrvTrend,
      rhr, rhrTrend,
      weekHours, weekCount
    };
  }, [wellnessData, activities]);

  const formZone = getFormZone(quickStats.form);
  const formColor = formZone ? FORM_ZONE_COLORS[formZone] : colors.success;

  const renderActivity = ({ item }: { item: Activity }) => (
    <ActivityCard activity={item} />
  );

  const navigateToFitness = () => router.push('/fitness');
  const navigateToWellness = () => router.push('/wellness');
  const navigateToTraining = () => router.push('/training');
  const navigateToStats = () => router.push('/stats');

  const renderHeader = () => (
    <>
      {/* Header with profile and separate stat pills */}
      <View style={styles.header}>
        {/* Profile photo (static for now) */}
        <View style={[styles.profilePhoto, styles.profilePlaceholder, isDark && styles.profilePlaceholderDark]}>
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
        </View>

        {/* Separate pill buttons for each page */}
        <View style={styles.pillRow}>
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
                {quickStats.fitnessTrend && (
                  <Text style={styles.trendArrow}>{quickStats.fitnessTrend}</Text>
                )}
              </Text>
            </View>
            <Text style={[styles.pillDivider, isDark && styles.pillDividerDark]}>|</Text>
            <View style={styles.pillItem}>
              <Text style={[styles.pillLabel, isDark && styles.textDark]}>Form</Text>
              <Text style={[styles.pillValue, { color: formColor }]}>
                {quickStats.form > 0 ? '+' : ''}{quickStats.form}
              </Text>
            </View>
          </TouchableOpacity>

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
                {quickStats.hrvTrend && (
                  <Text style={styles.trendArrow}>{quickStats.hrvTrend}</Text>
                )}
              </Text>
            </View>
            {quickStats.rhr && (
              <>
                <Text style={[styles.pillDivider, isDark && styles.pillDividerDark]}>|</Text>
                <View style={styles.pillItem}>
                  <Text style={[styles.pillLabel, isDark && styles.textDark]}>RHR</Text>
                  <Text style={[styles.pillValueSmall, isDark && styles.textDark]}>
                    {quickStats.rhr}
                    {quickStats.rhrTrend && (
                      <Text style={styles.trendArrowSmall}>{quickStats.rhrTrend}</Text>
                    )}
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
              </Text>
            </View>
            <Text style={[styles.pillDivider, isDark && styles.pillDividerDark]}>|</Text>
            <View style={styles.pillItem}>
              <Text style={[styles.pillLabel, isDark && styles.textDark]}>Acts</Text>
              <Text style={[styles.pillValueSmall, isDark && styles.textDark]}>
                {quickStats.weekCount}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Stats → Performance page */}
          <TouchableOpacity
            style={[styles.pill, styles.pillPrimary]}
            onPress={navigateToStats}
            activeOpacity={0.7}
          >
            <Text style={styles.pillPrimaryText}>Stats</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Activities section header */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Recent Activities</Text>
      </View>
    </>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={[styles.emptyText, isDark && styles.textLight]}>
        No activities found
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

  if (isLoading && !activities) {
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
        data={activities}
        renderItem={renderActivity}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={isError ? renderError : renderEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    // Subtle shadow for depth
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
    fontSize: 13,
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
  pillPrimary: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
  },
  pillPrimaryText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
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
  textDark: {
    color: '#AAA',
  },
});
