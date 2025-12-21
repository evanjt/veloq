import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PowerCurveChart, ZoneDistributionChart, FTPTrendChart, DecouplingChart } from '@/components/stats';
import { useActivities, useActivityStreams, useZoneDistribution, useEFTPHistory, getLatestFTP } from '@/hooks';
import { colors, spacing, layout } from '@/theme';

export default function StatsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Fetch activities for zone distribution (last 30 days)
  const { data: activities30d, isLoading: loading30d } = useActivities({ days: 30 });

  // Fetch activities for eFTP history (last 365 days)
  const { data: activities365d, isLoading: loading365d } = useActivities({ days: 365 });

  // Compute zone distributions
  const powerZones = useZoneDistribution({ type: 'power', activities: activities30d });
  const hrZones = useZoneDistribution({ type: 'hr', activities: activities30d });

  // Compute eFTP history
  const eftpHistory = useEFTPHistory(activities365d);
  const currentFTP = getLatestFTP(activities365d);

  // Find a recent activity with power data for decoupling analysis
  const decouplingActivity = useMemo(() => {
    if (!activities30d) return null;
    // Find the most recent ride/run with power and HR that's at least 30 mins
    return activities30d.find(a =>
      (a.type === 'Ride' || a.type === 'VirtualRide') &&
      a.average_watts &&
      a.icu_average_hr &&
      a.moving_time >= 30 * 60
    ) || null;
  }, [activities30d]);

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
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>Performance</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Power Curve */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <PowerCurveChart height={220} />
        </View>

        {/* Zone Distribution - Power */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {loading30d ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <ZoneDistributionChart data={powerZones} type="power" height={220} periodLabel="Last 30 days" />
          )}
        </View>

        {/* Zone Distribution - HR */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {loading30d ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <ZoneDistributionChart data={hrZones} type="hr" height={220} periodLabel="Last 30 days" />
          )}
        </View>

        {/* eFTP Trend */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {loading365d ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <FTPTrendChart data={eftpHistory} currentFTP={currentFTP} height={200} />
          )}
        </View>

        {/* Aerobic Decoupling */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {loadingStreams ? (
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
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
