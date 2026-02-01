import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING, CollapsibleSection } from '@/components/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import * as WebBrowser from 'expo-web-browser';
import { useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { FitnessChart, FormZoneChart, ActivityDotsChart } from '@/components/fitness';
import {
  PowerCurveChart,
  PaceCurveChart,
  SwimPaceCurveChart,
  ZoneDistributionChart,
  FTPTrendChart,
  DecouplingChart,
} from '@/components/stats';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NetworkErrorState, ErrorStatePreset } from '@/components/ui';
import {
  useWellness,
  useActivities,
  useActivityStreams,
  useZoneDistribution,
  useEFTPHistory,
  getLatestFTP,
  useSportSettings,
  getSettingsForSport,
  usePaceCurve,
  useTheme,
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  type TimeRange,
} from '@/hooks';
import { useNetwork, useSportPreference, SPORT_COLORS, type PrimarySport } from '@/providers';
import {
  formatLocalDate,
  formatShortDateWithWeekday,
  formatPaceCompact,
  formatSwimPace,
} from '@/lib';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { createSharedStyles } from '@/styles';

const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: '7d', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
];

// Convert TimeRange to days for activity fetching
const timeRangeToDays = (range: TimeRange): number => {
  switch (range) {
    case '7d':
      return 7;
    case '1m':
      return 30;
    case '3m':
      return 90;
    case '6m':
      return 180;
    case '1y':
      return 365;
    default:
      return 90;
  }
};

export default function FitnessScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('FitnessScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const [timeRange, setTimeRange] = useState<TimeRange>('3m');
  const [chartInteracting, setChartInteracting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Collapsible section state - performance expanded by default
  const [performanceExpanded, setPerformanceExpanded] = useState(true);
  const [zonesExpanded, setZonesExpanded] = useState(false);
  const [trendsExpanded, setTrendsExpanded] = useState(false);
  const [efficiencyExpanded, setEfficiencyExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedValues, setSelectedValues] = useState<{
    fitness: number;
    fatigue: number;
    form: number;
  } | null>(null);

  // Shared value for instant crosshair sync between charts
  const sharedSelectedIdx = useSharedValue(-1);

  // Reset selection when time range changes
  React.useEffect(() => {
    sharedSelectedIdx.value = -1;
    setSelectedDate(null);
    setSelectedValues(null);
    // Note: sharedSelectedIdx is a Reanimated SharedValue and should NOT be in deps
    // (it's intentionally outside the React render cycle)
  }, [timeRange]);

  const { data: wellness, isLoading, isFetching, isError, error, refetch } = useWellness(timeRange);
  const { isOnline } = useNetwork();
  const { primarySport } = useSportPreference();

  // Sport mode state - defaults to primary sport, can be toggled
  const [sportMode, setSportMode] = useState<PrimarySport>(() => primarySport);

  // Update sport mode when primary sport preference changes
  useEffect(() => {
    setSportMode(primarySport);
  }, [primarySport]);

  // Fetch activities for the selected time range (with stats for zone/eFTP)
  const { data: activities, isLoading: loadingActivities } = useActivities({
    days: timeRangeToDays(timeRange),
    includeStats: true,
  });

  // Background sync: prefetch 1 year of activities on first load for cache
  useActivities({ days: 365 });

  // Compute zone distributions - filtered by current sport mode
  const powerZones = useZoneDistribution({
    type: 'power',
    activities,
    sport: sportMode,
  });
  const hrZones = useZoneDistribution({
    type: 'hr',
    activities,
    sport: sportMode,
  });

  // Compute eFTP history and current FTP
  const eftpHistory = useEFTPHistory(activities);
  const currentFTP = getLatestFTP(activities);

  // Get sport settings for thresholds
  const { data: sportSettings } = useSportSettings();
  const runSettings = getSettingsForSport(sportSettings, 'Run');
  const runLthr = runSettings?.lthr;
  const runMaxHr = runSettings?.max_hr;

  // Get pace curve for critical speed (threshold pace)
  const { data: runPaceCurve } = usePaceCurve({
    sport: 'Run',
    days: timeRangeToDays(timeRange),
  });
  const thresholdPace = runPaceCurve?.criticalSpeed;

  // Get swim pace curve for threshold (CSS - critical swim speed)
  const { data: swimPaceCurve } = usePaceCurve({
    sport: 'Swim',
    days: timeRangeToDays(timeRange),
  });
  const swimThresholdPace = swimPaceCurve?.criticalSpeed;

  // Find a recent activity with power data for decoupling analysis
  const decouplingActivity = useMemo(() => {
    if (!activities) return null;
    return (
      activities.find(
        (a) =>
          (a.type === 'Ride' || a.type === 'VirtualRide') &&
          (a.icu_average_watts || a.average_watts) &&
          (a.average_heartrate || a.icu_average_hr) &&
          a.moving_time >= 30 * 60
      ) || null
    );
  }, [activities]);

  // Compute FTP trend (compare current to avg of previous values)
  const ftpTrend = useMemo(() => {
    if (!eftpHistory || eftpHistory.length < 2) return null;
    const current = eftpHistory[eftpHistory.length - 1].eftp;
    const previous = eftpHistory[eftpHistory.length - 2].eftp;
    if (current === previous) return 'stable';
    return current > previous ? 'up' : 'down';
  }, [eftpHistory]);

  // Compute dominant zone for header display
  const dominantZone = useMemo(() => {
    const zones = sportMode === 'Cycling' ? powerZones : hrZones;
    if (!zones || zones.length === 0) return null;
    const sorted = [...zones].sort((a, b) => b.percentage - a.percentage);
    const top = sorted[0];
    if (top.percentage === 0) return null;
    return { name: top.name, percentage: top.percentage };
  }, [sportMode, powerZones, hrZones]);

  // Fetch streams for the decoupling activity
  const { data: decouplingStreams, isLoading: loadingStreams } = useActivityStreams(
    decouplingActivity?.id || ''
  );

  // Compute decoupling percentage for header display
  const decouplingValue = useMemo(() => {
    if (!decouplingStreams?.watts || !decouplingStreams?.heartrate) return null;
    const power = decouplingStreams.watts;
    const hr = decouplingStreams.heartrate;
    if (power.length === 0 || hr.length === 0) return null;

    const midpoint = Math.floor(power.length / 2);
    const avgFirstPower = power.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
    const avgFirstHR = hr.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
    const avgSecondPower =
      power.slice(midpoint).reduce((a, b) => a + b, 0) / (power.length - midpoint);
    const avgSecondHR = hr.slice(midpoint).reduce((a, b) => a + b, 0) / (hr.length - midpoint);

    const firstHalfEf = avgFirstPower / avgFirstHR;
    const secondHalfEf = avgSecondPower / avgSecondHR;
    const decoupling = ((firstHalfEf - secondHalfEf) / firstHalfEf) * 100;
    const isGood = decoupling < 5;

    return { value: decoupling, isGood };
  }, [decouplingStreams]);

  // Handle chart interaction state changes
  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  // Handle date selection from charts
  const handleDateSelect = useCallback(
    (date: string | null, values: { fitness: number; fatigue: number; form: number } | null) => {
      setSelectedDate(date);
      setSelectedValues(values);
    },
    []
  );

  // Handle pull-to-refresh
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  // Memoize current (latest) values - only recompute when wellness data changes
  const currentValues = useMemo(() => {
    if (!wellness || wellness.length === 0) return null;
    const sorted = [...wellness].sort((a, b) => b.id.localeCompare(a.id));
    const latest = sorted[0];
    const fitnessRaw = latest.ctl ?? latest.ctlLoad ?? 0;
    const fatigueRaw = latest.atl ?? latest.atlLoad ?? 0;
    // Use rounded values for form calculation to match intervals.icu display
    const fitness = Math.round(fitnessRaw);
    const fatigue = Math.round(fatigueRaw);
    return { fitness, fatigue, form: fitness - fatigue, date: latest.id };
  }, [wellness]);
  const displayValues = selectedValues || currentValues;
  const displayDate = selectedDate || currentValues?.date;
  const formZone = displayValues ? getFormZone(displayValues.form) : null;

  // Only show full loading on initial load (no data yet)
  if (isLoading && !wellness) {
    return (
      <ScreenSafeAreaView style={shared.container}>
        <View style={styles.header}>
          <Text style={shared.headerTitle}>{t('fitnessScreen.title')}</Text>
        </View>
        <View style={shared.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>
            {t('fitnessScreen.loadingData')}
          </Text>
        </View>
      </ScreenSafeAreaView>
    );
  }

  if (isError || !wellness) {
    // Check if this is a network error
    const axiosError = error as { code?: string };
    const isNetworkError =
      axiosError?.code === 'ERR_NETWORK' ||
      axiosError?.code === 'ECONNABORTED' ||
      axiosError?.code === 'ETIMEDOUT';

    return (
      <ScreenSafeAreaView style={shared.container}>
        <View style={styles.header}>
          <Text style={shared.headerTitle}>{t('fitnessScreen.title')}</Text>
        </View>
        <View style={shared.loadingContainer}>
          {isNetworkError ? (
            <NetworkErrorState onRetry={() => refetch()} />
          ) : (
            <ErrorStatePreset message={t('fitnessScreen.failedToLoad')} onRetry={() => refetch()} />
          )}
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenSafeAreaView style={shared.container} testID="fitness-screen">
      {/* Header */}
      <View style={styles.header}>
        <Text style={shared.headerTitle}>{t('fitnessScreen.title')}</Text>
        {/* Subtle loading indicator in header when fetching in background (not during pull-to-refresh) */}
        {isFetching && !isRefreshing && (
          <ActivityIndicator size="small" color={colors.primary} style={styles.headerSpinner} />
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={isOnline ? onRefresh : undefined}
            enabled={isOnline}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Current stats card */}
        <View style={[styles.statsCard, isDark && styles.statsCardDark]}>
          <Text style={[styles.statsDate, isDark && styles.statsDateDark]}>
            {displayDate ? formatDisplayDate(displayDate) : t('fitnessScreen.current')}
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                {t('metrics.fitness')}
              </Text>
              <Text style={[styles.statValue, { color: colors.fitnessBlue }]}>
                {displayValues ? Math.round(displayValues.fitness) : '-'}
              </Text>
              <Text style={[styles.statSubtext, isDark && styles.statSubtextDark]}>
                {t('fitnessScreen.ctl')}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                {t('metrics.fatigue')}
              </Text>
              <Text style={[styles.statValue, { color: colors.fatiguePurple }]}>
                {displayValues ? Math.round(displayValues.fatigue) : '-'}
              </Text>
              <Text style={[styles.statSubtext, isDark && styles.statSubtextDark]}>
                {t('fitnessScreen.atl')}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                {t('metrics.form')}
              </Text>
              <Text
                style={[
                  styles.statValue,
                  {
                    color: formZone ? FORM_ZONE_COLORS[formZone] : themeColors.text,
                  },
                ]}
              >
                {displayValues
                  ? `${displayValues.form > 0 ? '+' : ''}${Math.round(displayValues.form)}`
                  : '-'}
              </Text>
              <Text
                style={[
                  styles.statSubtext,
                  {
                    color: formZone ? FORM_ZONE_COLORS[formZone] : themeColors.textSecondary,
                  },
                ]}
              >
                {formZone ? FORM_ZONE_LABELS[formZone] : t('fitnessScreen.tsb')}
              </Text>
            </View>
          </View>
        </View>

        {/* Time range selector */}
        <View style={styles.timeRangeContainer}>
          {TIME_RANGES.map((range) => (
            <TouchableOpacity
              key={range.id}
              style={[
                styles.timeRangeButton,
                isDark && styles.timeRangeButtonDark,
                timeRange === range.id && styles.timeRangeButtonActive,
              ]}
              onPress={() => setTimeRange(range.id)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.timeRangeText,
                  isDark && styles.timeRangeTextDark,
                  timeRange === range.id && styles.timeRangeTextActive,
                ]}
              >
                {range.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Combined fitness charts card */}
        <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
          {/* Fitness/Fatigue chart */}
          <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>
            {t('fitnessScreen.fitnessAndFatigue')}
          </Text>
          <FitnessChart
            data={wellness}
            height={220}
            selectedDate={selectedDate}
            sharedSelectedIdx={sharedSelectedIdx}
            onDateSelect={handleDateSelect}
            onInteractionChange={handleInteractionChange}
          />

          {/* Activity dots chart */}
          <View style={[styles.dotsSection, isDark && styles.dotsSectionDark]}>
            <ActivityDotsChart
              data={wellness}
              activities={activities || []}
              height={32}
              selectedDate={selectedDate}
              sharedSelectedIdx={sharedSelectedIdx}
              onDateSelect={handleDateSelect}
              onInteractionChange={handleInteractionChange}
            />
          </View>

          {/* Form zone chart */}
          <View style={[styles.formSection, isDark && styles.formSectionDark]}>
            <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>
              {t('metrics.form')}
            </Text>
            <FormZoneChart
              data={wellness}
              height={140}
              selectedDate={selectedDate}
              sharedSelectedIdx={sharedSelectedIdx}
              onDateSelect={handleDateSelect}
              onInteractionChange={handleInteractionChange}
            />
          </View>
        </View>

        {/* Sport Toggle - compact pill selector */}
        <View style={styles.sportToggleContainer}>
          {(['Cycling', 'Running', 'Swimming'] as const).map((sport) => (
            <TouchableOpacity
              key={sport}
              style={[
                styles.sportToggleButton,
                isDark && styles.sportToggleButtonDark,
                sportMode === sport && { backgroundColor: SPORT_COLORS[sport] },
              ]}
              onPress={() => setSportMode(sport)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={sport === 'Cycling' ? 'bike' : sport === 'Running' ? 'run' : 'swim'}
                size={16}
                color={sportMode === sport ? colors.textOnDark : themeColors.textSecondary}
              />
              <Text
                style={[
                  styles.sportToggleText,
                  isDark && styles.sportToggleTextDark,
                  sportMode === sport && styles.sportToggleTextActive,
                ]}
              >
                {t(`filters.${sport.toLowerCase()}` as never)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Performance Section - Power/Pace Curve (expanded by default) */}
        <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
          <CollapsibleSection
            title={
              sportMode === 'Cycling'
                ? t('statsScreen.powerCurve')
                : sportMode === 'Swimming'
                  ? t('statsScreen.swimPaceCurve')
                  : t('statsScreen.paceCurve')
            }
            icon={sportMode === 'Cycling' ? 'lightning-bolt' : 'speedometer'}
            expanded={performanceExpanded}
            onToggle={setPerformanceExpanded}
            estimatedHeight={240}
            headerRight={
              sportMode === 'Cycling' && currentFTP ? (
                <Text style={[styles.headerValue, { color: SPORT_COLORS.Cycling }]}>
                  {currentFTP}w
                </Text>
              ) : sportMode === 'Running' && thresholdPace ? (
                <Text style={[styles.headerValue, { color: SPORT_COLORS.Running }]}>
                  {formatPaceCompact(thresholdPace)}/km
                </Text>
              ) : sportMode === 'Swimming' && swimThresholdPace ? (
                <Text style={[styles.headerValue, { color: SPORT_COLORS.Swimming }]}>
                  {formatSwimPace(swimThresholdPace)}/100m
                </Text>
              ) : null
            }
          >
            <View style={styles.collapsibleContent}>
              {sportMode === 'Cycling' && (
                <PowerCurveChart height={200} days={timeRangeToDays(timeRange)} ftp={currentFTP} />
              )}
              {sportMode === 'Running' && (
                <PaceCurveChart height={200} days={timeRangeToDays(timeRange)} />
              )}
              {sportMode === 'Swimming' && (
                <SwimPaceCurveChart height={200} days={timeRangeToDays(timeRange)} />
              )}
            </View>
          </CollapsibleSection>
        </View>

        {/* Training Zones Section */}
        <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
          <CollapsibleSection
            title={t('statsScreen.trainingZones')}
            icon="chart-bar"
            expanded={zonesExpanded}
            onToggle={setZonesExpanded}
            estimatedHeight={sportMode === 'Cycling' ? 400 : 200}
            headerRight={
              dominantZone ? (
                <Text style={[styles.headerValue, { color: SPORT_COLORS[sportMode] }]}>
                  {dominantZone.name}: {dominantZone.percentage}%
                </Text>
              ) : null
            }
          >
            <View style={styles.collapsibleContent}>
              {loadingActivities && !activities ? (
                <View style={styles.zoneLoadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <>
                  {sportMode === 'Cycling' && (
                    <View style={styles.zoneSection}>
                      <ZoneDistributionChart
                        data={powerZones}
                        type="power"
                        periodLabel={TIME_RANGES.find((r) => r.id === timeRange)?.label || '3M'}
                      />
                    </View>
                  )}
                  <View style={sportMode === 'Cycling' ? styles.zoneSectionDivided : undefined}>
                    <ZoneDistributionChart
                      data={hrZones}
                      type="hr"
                      periodLabel={TIME_RANGES.find((r) => r.id === timeRange)?.label || '3M'}
                    />
                  </View>
                </>
              )}
            </View>
          </CollapsibleSection>
        </View>

        {/* Trends Section - eFTP/Threshold */}
        {sportMode === 'Cycling' && (
          <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
            <CollapsibleSection
              title={t('statsScreen.eFTPTrend')}
              icon="trending-up"
              expanded={trendsExpanded}
              onToggle={setTrendsExpanded}
              estimatedHeight={220}
              headerRight={
                currentFTP ? (
                  <View style={styles.headerValueRow}>
                    <Text style={[styles.headerValue, { color: SPORT_COLORS.Cycling }]}>
                      {currentFTP}w
                    </Text>
                    {ftpTrend && ftpTrend !== 'stable' && (
                      <MaterialCommunityIcons
                        name={ftpTrend === 'up' ? 'trending-up' : 'trending-down'}
                        size={16}
                        color={ftpTrend === 'up' ? colors.success : colors.error}
                        style={styles.trendIcon}
                      />
                    )}
                  </View>
                ) : null
              }
            >
              <View style={styles.collapsibleContent}>
                {loadingActivities && !activities ? (
                  <View style={styles.zoneLoadingContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : (
                  <FTPTrendChart data={eftpHistory} currentFTP={currentFTP} height={180} />
                )}
              </View>
            </CollapsibleSection>
          </View>
        )}

        {/* Running Threshold Stats */}
        {sportMode === 'Running' && (thresholdPace || runLthr) && (
          <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
            <CollapsibleSection
              title={t('statsScreen.lactateThreshold')}
              icon="heart-pulse"
              expanded={trendsExpanded}
              onToggle={setTrendsExpanded}
              estimatedHeight={100}
              headerRight={
                thresholdPace ? (
                  <Text style={[styles.headerValue, { color: SPORT_COLORS.Running }]}>
                    {formatPaceCompact(thresholdPace)}/km
                  </Text>
                ) : runLthr ? (
                  <Text style={[styles.headerValue, { color: SPORT_COLORS.Running }]}>
                    {runLthr} bpm
                  </Text>
                ) : null
              }
            >
              <View style={styles.collapsibleContent}>
                <View style={styles.thresholdRow}>
                  <View style={styles.thresholdItem}>
                    <Text style={[styles.thresholdLabel, isDark && styles.thresholdLabelDark]}>
                      {t('statsScreen.pace')}
                    </Text>
                    <Text style={[styles.thresholdValue, { color: SPORT_COLORS.Running }]}>
                      {thresholdPace ? `${formatPaceCompact(thresholdPace)}/km` : '-'}
                    </Text>
                  </View>
                  {runLthr && (
                    <>
                      <View style={styles.thresholdDivider} />
                      <View style={styles.thresholdItem}>
                        <Text style={[styles.thresholdLabel, isDark && styles.thresholdLabelDark]}>
                          {t('statsScreen.heartRate')}
                        </Text>
                        <Text style={[styles.thresholdValue, { color: SPORT_COLORS.Running }]}>
                          {runLthr} bpm
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              </View>
            </CollapsibleSection>
          </View>
        )}

        {/* Efficiency Section - Decoupling (Cycling only) */}
        {sportMode === 'Cycling' && (
          <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
            <CollapsibleSection
              title={t('statsScreen.decoupling')}
              icon="heart-flash"
              expanded={efficiencyExpanded}
              onToggle={setEfficiencyExpanded}
              estimatedHeight={160}
              headerRight={
                decouplingValue ? (
                  <Text
                    style={[
                      styles.headerValue,
                      { color: decouplingValue.isGood ? colors.success : colors.warning },
                    ]}
                  >
                    {decouplingValue.value.toFixed(1)}%
                  </Text>
                ) : null
              }
            >
              <View style={styles.collapsibleContent}>
                {loadingStreams && !decouplingStreams ? (
                  <View style={styles.zoneLoadingContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : (
                  <DecouplingChart
                    power={decouplingStreams?.watts}
                    heartrate={decouplingStreams?.heartrate}
                    height={120}
                  />
                )}
              </View>
            </CollapsibleSection>
          </View>
        )}

        {/* Info section */}
        <View style={[styles.infoCard, isDark && styles.infoCardDark]}>
          <Text style={[styles.infoTitle, isDark && styles.infoTitleDark]}>
            {t('fitnessScreen.understandingMetrics')}
          </Text>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: colors.fitnessBlue }]} />
            <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
              <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>
                {t('metrics.fitness')}
              </Text>{' '}
              {t('fitnessScreen.fitnessDescription')}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: colors.fatiguePurple }]} />
            <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
              <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>
                {t('metrics.fatigue')}
              </Text>{' '}
              {t('fitnessScreen.fatigueDescription')}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: FORM_ZONE_COLORS.optimal }]} />
            <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
              <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>
                {t('metrics.form')}
              </Text>{' '}
              {t('fitnessScreen.formDescription')}{' '}
              <Text style={{ color: FORM_ZONE_COLORS.optimal }}>
                {t('fitnessScreen.optimalZone')}
              </Text>{' '}
              {t('fitnessScreen.toBuildFitness')}{' '}
              <Text style={{ color: FORM_ZONE_COLORS.fresh }}>{t('fitnessScreen.fresh')}</Text>{' '}
              {t('fitnessScreen.forRaces')}{' '}
              <Text style={{ color: FORM_ZONE_COLORS.highRisk }}>
                {t('fitnessScreen.highRiskZone')}
              </Text>{' '}
              {t('fitnessScreen.toPreventOvertraining')}
            </Text>
          </View>

          <View style={[styles.referencesSection, isDark && styles.referencesSectionDark]}>
            <Text style={[styles.referencesLabel, isDark && styles.referencesLabelDark]}>
              {t('fitnessScreen.learnMore')}
            </Text>
            <TouchableOpacity
              onPress={() => WebBrowser.openBrowserAsync('https://intervals.icu/fitness')}
              activeOpacity={0.7}
            >
              <Text style={styles.infoLink}>intervals.icu Fitness Page</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                WebBrowser.openBrowserAsync(
                  'https://www.sciencetosport.com/monitoring-training-load/'
                )
              }
              activeOpacity={0.7}
            >
              <Text style={styles.infoLink}>Monitoring Training Load (Science2Sport)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                WebBrowser.openBrowserAsync(
                  'https://www.joefrielsblog.com/2015/12/managing-training-using-tsb.html'
                )
              }
              activeOpacity={0.7}
            >
              <Text style={styles.infoLink}>Managing Training Using TSB (Joe Friel)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

function formatDisplayDate(dateStr: string): string {
  return formatShortDateWithWeekday(dateStr);
}

const styles = StyleSheet.create({
  // Note: container, headerTitle, loadingContainer now use shared styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
  },
  headerSpinner: {
    marginLeft: spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: layout.screenPadding + TAB_BAR_SAFE_PADDING,
  },
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  statsCardDark: {
    backgroundColor: darkColors.surface,
  },
  statsDate: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  statsDateDark: {
    color: darkColors.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  statLabelDark: {
    color: darkColors.textSecondary,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  statSubtext: {
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statSubtextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  timeRangeButton: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  timeRangeButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeRangeTextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeTextActive: {
    color: colors.textOnDark,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  chartCardDark: {
    backgroundColor: darkColors.surface,
  },
  dotsSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: opacity.overlay.medium,
  },
  dotsSectionDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  formSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: opacity.overlay.medium,
  },
  formSectionDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  chartTitle: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  chartTitleDark: {
    color: darkColors.textPrimary,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  infoCardDark: {
    backgroundColor: darkColors.surface,
  },
  infoTitle: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  infoTitleDark: {
    color: darkColors.textPrimary,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  infoDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
    marginTop: 5,
    marginRight: spacing.xs,
  },
  infoText: {
    flex: 1,
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  infoTextDark: {
    color: darkColors.textSecondary,
  },
  infoHighlight: {
    fontWeight: '600',
  },
  infoHighlightDark: {
    color: darkColors.textPrimary,
  },
  referencesSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: opacity.overlay.light,
  },
  referencesSectionDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  referencesLabel: {
    ...typography.label,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  referencesLabelDark: {
    color: darkColors.textSecondary,
  },
  infoLink: {
    ...typography.caption,
    color: colors.primary,
    paddingVertical: spacing.xs,
  },
  sportToggleContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sportToggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.light,
    gap: 6,
  },
  sportToggleButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  sportToggleText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sportToggleTextDark: {
    color: darkColors.textSecondary,
  },
  sportToggleTextActive: {
    color: colors.textOnDark,
  },
  headerValue: {
    ...typography.bodyBold,
    marginRight: spacing.sm,
  },
  headerValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendIcon: {
    marginLeft: 2,
    marginRight: spacing.sm,
  },
  zoneLoadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  collapsibleCardDark: {
    backgroundColor: darkColors.surface,
  },
  collapsibleContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  zoneSection: {
    marginBottom: spacing.md,
  },
  zoneSectionDivided: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: opacity.overlay.medium,
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
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  thresholdLabelDark: {
    color: darkColors.textSecondary,
  },
  thresholdValue: {
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
  },
  thresholdValueSmall: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  thresholdValueSmallDark: {
    color: darkColors.textSecondary,
  },
  thresholdDivider: {
    width: 1,
    height: 40,
    backgroundColor: opacity.overlay.medium,
    marginHorizontal: spacing.md,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  loadingTextDark: {
    color: darkColors.textSecondary,
  },
});
