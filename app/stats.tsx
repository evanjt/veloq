import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, TouchableOpacity, Linking } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PowerCurveChart, PaceCurveChart, SwimPaceCurveChart, ZoneDistributionChart, FTPTrendChart, DecouplingChart } from '@/components/stats';
import { useActivities, useActivityStreams, useZoneDistribution, useEFTPHistory, getLatestFTP, usePowerCurve, useSportSettings, getSettingsForSport, usePaceCurve } from '@/hooks';
import { useSportPreference, SPORT_COLORS, type PrimarySport } from '@/providers';
import { formatPaceCompact } from '@/lib';
import { colors, spacing, layout } from '@/theme';

type TimeRange = '42d' | '90d' | '180d' | '1y';

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string; days: number }[] = [
  { value: '42d', label: '42 Days', days: 42 },
  { value: '90d', label: '3 Months', days: 90 },
  { value: '180d', label: '6 Months', days: 180 },
  { value: '1y', label: '1 Year', days: 365 },
];

export default function StatsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Time range state - default to 42d to match CTL/pace curve windows
  const [timeRange, setTimeRange] = useState<TimeRange>('42d');
  const selectedRange = TIME_RANGE_OPTIONS.find(r => r.value === timeRange) ?? TIME_RANGE_OPTIONS[0];

  // Sport mode state - defaults to primary sport from preferences
  const { primarySport } = useSportPreference();
  const [sportMode, setSportMode] = useState<PrimarySport>(primarySport);

  // Update sport mode when primary sport preference changes
  useEffect(() => {
    setSportMode(primarySport);
  }, [primarySport]);

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

  // Get sport settings for thresholds
  const { data: sportSettings } = useSportSettings();
  const runSettings = getSettingsForSport(sportSettings, 'Run');
  const runLthr = runSettings?.lthr;
  const runMaxHr = runSettings?.max_hr;

  // Get pace curve for critical speed (threshold pace)
  const { data: runPaceCurve } = usePaceCurve({ sport: 'Run', days: selectedRange.days });
  const thresholdPace = runPaceCurve?.criticalSpeed;

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

      {/* Sport Toggle */}
      <View style={styles.sportToggleContainer}>
        <TouchableOpacity
          style={[
            styles.sportToggleButton,
            isDark && styles.sportToggleButtonDark,
            sportMode === 'Cycling' && { backgroundColor: SPORT_COLORS.Cycling },
          ]}
          onPress={() => setSportMode('Cycling')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="bike"
            size={16}
            color={sportMode === 'Cycling' ? '#FFF' : (isDark ? '#AAA' : colors.textSecondary)}
          />
          <Text
            style={[
              styles.sportToggleText,
              isDark && styles.textDark,
              sportMode === 'Cycling' && styles.sportToggleTextActive,
            ]}
          >
            Cycling
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.sportToggleButton,
            isDark && styles.sportToggleButtonDark,
            sportMode === 'Running' && { backgroundColor: SPORT_COLORS.Running },
          ]}
          onPress={() => setSportMode('Running')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="run"
            size={16}
            color={sportMode === 'Running' ? '#FFF' : (isDark ? '#AAA' : colors.textSecondary)}
          />
          <Text
            style={[
              styles.sportToggleText,
              isDark && styles.textDark,
              sportMode === 'Running' && styles.sportToggleTextActive,
            ]}
          >
            Running
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.sportToggleButton,
            isDark && styles.sportToggleButtonDark,
            sportMode === 'Swimming' && { backgroundColor: SPORT_COLORS.Swimming },
          ]}
          onPress={() => setSportMode('Swimming')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="swim"
            size={16}
            color={sportMode === 'Swimming' ? '#FFF' : (isDark ? '#AAA' : colors.textSecondary)}
          />
          <Text
            style={[
              styles.sportToggleText,
              isDark && styles.textDark,
              sportMode === 'Swimming' && styles.sportToggleTextActive,
            ]}
          >
            Swimming
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Cycling Charts */}
        {sportMode === 'Cycling' && (
          <>
            {/* Power Curve */}
            <View style={[styles.card, isDark && styles.cardDark]}>
              <PowerCurveChart height={220} days={selectedRange.days} ftp={currentFTP} />
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

            {/* Power Curve Info */}
            <View style={styles.infoFooter}>
              <Text style={[styles.infoText, isDark && styles.textDark]}>
                Estimated FTP is calculated using power curves from FastFitness.Tips and Morton's 3 parameter critical power model.
                The algorithm requires just 1 max effort of between 180 seconds and 30 minutes.
                Note that all data for the selected power curves is used and there is no decay so the eFTP value on the chart may differ to your current eFTP.
                W' is relative to eFTP.
              </Text>
              <View style={styles.refLinks}>
                <TouchableOpacity onPress={() => Linking.openURL('https://intervals.icu/power')}>
                  <Text style={styles.refLink}>intervals.icu/power</Text>
                </TouchableOpacity>
                <Text style={[styles.refSeparator, isDark && styles.textDark]}>•</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://doi.org/10.1080/00140139608964484')}>
                  <Text style={styles.refLink}>Ref</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.garminNote, isDark && styles.textDark]}>
                Charts may include data from Garmin devices
              </Text>
            </View>
          </>
        )}

        {/* Running Charts */}
        {sportMode === 'Running' && (
          <>
            {/* Threshold Stats */}
            <View style={[styles.card, isDark && styles.cardDark]}>
              <Text style={[styles.cardTitle, isDark && styles.textLight]}>Lactate Threshold</Text>
              <View style={styles.thresholdRow}>
                <View style={styles.thresholdItem}>
                  <Text style={[styles.thresholdLabel, isDark && styles.textDark]}>Pace</Text>
                  <Text style={[styles.thresholdValue, { color: SPORT_COLORS.Running }]}>
                    {thresholdPace ? `${formatPaceCompact(thresholdPace)}/km` : '-'}
                  </Text>
                </View>
                <View style={styles.thresholdDivider} />
                <View style={styles.thresholdItem}>
                  <Text style={[styles.thresholdLabel, isDark && styles.textDark]}>Heart Rate</Text>
                  <Text style={[styles.thresholdValue, { color: SPORT_COLORS.Running }]}>
                    {runLthr ? `${runLthr} bpm` : '-'}
                  </Text>
                </View>
                {runMaxHr && (
                  <>
                    <View style={styles.thresholdDivider} />
                    <View style={styles.thresholdItem}>
                      <Text style={[styles.thresholdLabel, isDark && styles.textDark]}>Max HR</Text>
                      <Text style={[styles.thresholdValueSmall, isDark && styles.textDark]}>
                        {runMaxHr} bpm
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </View>

            {/* Pace Curve */}
            <View style={[styles.card, isDark && styles.cardDark]}>
              <PaceCurveChart height={280} days={selectedRange.days} />
            </View>

            {/* Power Curve (for runners with Stryd etc) */}
            <View style={[styles.card, isDark && styles.cardDark]}>
              <PowerCurveChart
                height={220}
                days={selectedRange.days}
                sport="Run"
                color={SPORT_COLORS.Running}
              />
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

            {/* Pace Curve Info */}
            <View style={styles.infoFooter}>
              <Text style={[styles.infoTextTitle, isDark && styles.textDark]}>Pace Curve</Text>
              <Text style={[styles.infoText, isDark && styles.textDark]}>
                CS (critical speed) and D' are calculated using the 2 parameter model.
                Intervals.icu uses your best 1k, 2k, 3k, 4k and 5k times keeping those that take between 2 and 15+ minutes.
              </Text>
              <View style={styles.refLinks}>
                <TouchableOpacity onPress={() => Linking.openURL('https://intervals.icu/pace')}>
                  <Text style={styles.refLink}>intervals.icu/pace</Text>
                </TouchableOpacity>
                <Text style={[styles.refSeparator, isDark && styles.textDark]}>•</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://www.tandfonline.com/doi/abs/10.1080/02640410500497642')}>
                  <Text style={styles.refLink}>Ref</Text>
                </TouchableOpacity>
                <Text style={[styles.refSeparator, isDark && styles.textDark]}>•</Text>
                <TouchableOpacity onPress={() => Linking.openURL('http://www.georgeron.com/2020/04/Critical-Power-Concept.html')}>
                  <Text style={styles.refLink}>Ref</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Power Curve Info (for runners with power meters) */}
            <View style={styles.infoFooter}>
              <Text style={[styles.infoTextTitle, isDark && styles.textDark]}>Power Curve</Text>
              <Text style={[styles.infoText, isDark && styles.textDark]}>
                Estimated FTP is calculated using power curves from FastFitness.Tips and Morton's 3 parameter critical power model.
                The algorithm requires just 1 max effort of between 180 seconds and 30 minutes.
                W' is relative to eFTP.
              </Text>
              <View style={styles.refLinks}>
                <TouchableOpacity onPress={() => Linking.openURL('https://intervals.icu/power')}>
                  <Text style={styles.refLink}>intervals.icu/power</Text>
                </TouchableOpacity>
                <Text style={[styles.refSeparator, isDark && styles.textDark]}>•</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://doi.org/10.1080/00140139608964484')}>
                  <Text style={styles.refLink}>Ref</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.garminNote, isDark && styles.textDark]}>
                Charts may include data from Garmin devices
              </Text>
            </View>
          </>
        )}

        {/* Swimming Charts */}
        {sportMode === 'Swimming' && (
          <>
            {/* Swim Pace Curve */}
            <View style={[styles.card, isDark && styles.cardDark]}>
              <SwimPaceCurveChart height={280} days={selectedRange.days} />
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

            {/* Swim Pace Curve Info */}
            <View style={styles.infoFooter}>
              <Text style={[styles.infoText, isDark && styles.textDark]}>
                CSS (critical swim speed) and D' are calculated using the 2 parameter model.
                Based on your best swim efforts across various distances.
              </Text>
              <View style={styles.refLinks}>
                <TouchableOpacity onPress={() => Linking.openURL('https://intervals.icu/pace')}>
                  <Text style={styles.refLink}>intervals.icu/pace</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.garminNote, isDark && styles.textDark]}>
                Charts may include data from Garmin devices
              </Text>
            </View>
          </>
        )}
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
    backgroundColor: '#FF6B00',
  },
  timeRangeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  timeRangeTextActive: {
    color: '#FFFFFF',
  },
  sportToggleContainer: {
    flexDirection: 'row',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  sportToggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    gap: 6,
  },
  sportToggleButtonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  sportToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sportToggleTextActive: {
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
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thresholdItem: {
    flex: 1,
    alignItems: 'center',
  },
  thresholdLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  thresholdValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  thresholdValueSmall: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  thresholdDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    marginHorizontal: spacing.md,
  },
  infoFooter: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  infoTextTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  refLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  refLink: {
    fontSize: 11,
    color: colors.primary,
  },
  refSeparator: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  garminNote: {
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
});
