import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PowerCurveChart, ZoneDistributionChart, FTPTrendChart, DecouplingChart } from '@/components/stats';
import { useActivities, useActivityStreams, useZoneDistribution, useEFTPHistory, getLatestFTP, usePowerCurve } from '@/hooks';
import { colors, spacing, layout } from '@/theme';

type TimeRange = '30d' | '90d' | '180d' | '1y';

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string; days: number }[] = [
  { value: '30d', label: '30 Days', days: 30 },
  { value: '90d', label: '3 Months', days: 90 },
  { value: '180d', label: '6 Months', days: 180 },
  { value: '1y', label: '1 Year', days: 365 },
];

export default function StatsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Time range state
  const [timeRange, setTimeRange] = useState<TimeRange>('90d');
  const selectedRange = TIME_RANGE_OPTIONS.find(r => r.value === timeRange)!;

  // Fetch activities with stats fields (eFTP, zone times, etc.)
  const { data: activities, isLoading: loadingActivities, isFetching: fetchingActivities } = useActivities({
    days: selectedRange.days,
    includeStats: true,
  });

  // Alias for backward compatibility
  const activities30d = activities;
  const activities365d = activities;
  const loading30d = loadingActivities;
  const loading365d = loadingActivities;

  // Compute zone distributions
  const powerZones = useZoneDistribution({ type: 'power', activities: activities30d });
  const hrZones = useZoneDistribution({ type: 'hr', activities: activities30d });

  // Compute eFTP history
  const eftpHistory = useEFTPHistory(activities365d);
  const currentFTP = getLatestFTP(activities365d);

  // Find a recent activity with power data for decoupling analysis
  const decouplingActivity = useMemo(() => {
    if (!activities) return null;
    // Find the most recent ride with power and HR that's at least 30 mins
    // API returns icu_average_watts for power and average_heartrate for HR
    return activities.find(a =>
      (a.type === 'Ride' || a.type === 'VirtualRide') &&
      (a.icu_average_watts || a.average_watts) &&
      (a.average_heartrate || a.icu_average_hr) &&
      a.moving_time >= 30 * 60
    ) || null;
  }, [activities]);

  // Fetch streams for the decoupling activity
  const { data: decouplingStreams, isLoading: loadingStreams } = useActivityStreams(
    decouplingActivity?.id || ''
  );


  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Performance</Text>
          {fetchingActivities && (
            <ActivityIndicator size="small" color={colors.primary} style={styles.headerLoader} />
          )}
        </View>
        <View style={{ width: 48 }} />
      </View>

      {/* Time Range Selector */}
      <View style={styles.timeRangeContainer}>
        {TIME_RANGE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.timeRangeButton,
              isDark && styles.timeRangeButtonDark,
              timeRange === option.value && styles.timeRangeButtonActive,
            ]}
            onPress={() => setTimeRange(option.value)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.timeRangeText,
                isDark && styles.textDark,
                timeRange === option.value && styles.timeRangeTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Power Curve */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <PowerCurveChart height={220} days={selectedRange.days} />
        </View>

        {/* Zone Distribution - Power */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {loadingActivities && !activities ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <ZoneDistributionChart data={powerZones} type="power" periodLabel={selectedRange.label} />
          )}
        </View>

        {/* Zone Distribution - HR */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {loadingActivities && !activities ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <ZoneDistributionChart data={hrZones} type="hr" periodLabel={selectedRange.label} />
          )}
        </View>

        {/* eFTP Trend */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {loadingActivities && !activities ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <FTPTrendChart data={eftpHistory} currentFTP={currentFTP} height={200} />
          )}
        </View>

        {/* Aerobic Decoupling */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {loadingStreams && !decouplingStreams ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <DecouplingChart
              power={decouplingStreams?.watts}
              heartrate={decouplingStreams?.heartrate}
              height={140}
            />
          )}
        </View>
      </ScrollView>
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerLoader: {
    marginLeft: 4,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
  },
  timeRangeContainer: {
    flexDirection: 'row',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  timeRangeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    alignItems: 'center',
  },
  timeRangeButtonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  timeRangeButtonActive: {
    backgroundColor: '#5B9BD5',
  },
  timeRangeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  timeRangeTextActive: {
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: '#1E1E1E',
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
