import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useSharedValue } from 'react-native-reanimated';
import { FitnessChart, FormZoneChart, ActivityDotsChart } from '@/components/fitness';
import { useWellness, useActivities, getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS, type TimeRange } from '@/hooks';
import { formatLocalDate } from '@/lib';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';

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
    case '7d': return 7;
    case '1m': return 30;
    case '3m': return 90;
    case '6m': return 180;
    case '1y': return 365;
    default: return 90;
  }
};

export default function FitnessScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [timeRange, setTimeRange] = useState<TimeRange>('3m');
  const [chartInteracting, setChartInteracting] = useState(false);
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
  }, [timeRange, sharedSelectedIdx]);

  const { data: wellness, isLoading, isFetching, isError, refetch } = useWellness(timeRange);

  // Fetch activities for the selected time range
  const { data: activities } = useActivities({ days: timeRangeToDays(timeRange) });

  // Background sync: prefetch 1 year of activities on first load for cache
  useActivities({ days: 365 });

  // Handle chart interaction state changes
  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  // Handle date selection from charts
  const handleDateSelect = useCallback((date: string | null, values: { fitness: number; fatigue: number; form: number } | null) => {
    setSelectedDate(date);
    setSelectedValues(values);
  }, []);

  // Get current (latest) values for display when not selecting
  const getCurrentValues = () => {
    if (!wellness || wellness.length === 0) return null;
    const sorted = [...wellness].sort((a, b) => b.id.localeCompare(a.id));
    const latest = sorted[0];
    const fitnessRaw = latest.ctl ?? latest.ctlLoad ?? 0;
    const fatigueRaw = latest.atl ?? latest.atlLoad ?? 0;
    // Use rounded values for form calculation to match intervals.icu display
    const fitness = Math.round(fitnessRaw);
    const fatigue = Math.round(fatigueRaw);
    return { fitness, fatigue, form: fitness - fatigue, date: latest.id };
  };

  const currentValues = getCurrentValues();
  const displayValues = selectedValues || currentValues;
  const displayDate = selectedDate || currentValues?.date;
  const formZone = displayValues ? getFormZone(displayValues.form) : null;

  // Only show full loading on initial load (no data yet)
  if (isLoading && !wellness) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Fitness & Form</Text>
          <View style={{ width: 48 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, isDark && styles.textDark]}>Loading fitness data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !wellness) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Fitness & Form</Text>
          <View style={{ width: 48 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Failed to load fitness data</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Fitness & Form</Text>
          {isFetching && (
            <ActivityIndicator size="small" color={colors.primary} style={styles.headerLoader} />
          )}
        </View>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting}
      >
        {/* Current stats card */}
        <View style={[styles.statsCard, isDark && styles.cardDark]}>
          <Text style={[styles.statsDate, isDark && styles.textDark]}>
            {displayDate ? formatDisplayDate(displayDate) : 'Current'}
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, isDark && styles.textDark]}>Fitness</Text>
              <Text style={[styles.statValue, { color: '#42A5F5' }]}>
                {displayValues ? Math.round(displayValues.fitness) : '-'}
              </Text>
              <Text style={[styles.statSubtext, isDark && styles.textDark]}>CTL</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, isDark && styles.textDark]}>Fatigue</Text>
              <Text style={[styles.statValue, { color: '#AB47BC' }]}>
                {displayValues ? Math.round(displayValues.fatigue) : '-'}
              </Text>
              <Text style={[styles.statSubtext, isDark && styles.textDark]}>ATL</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, isDark && styles.textDark]}>Form</Text>
              <Text style={[styles.statValue, { color: formZone ? FORM_ZONE_COLORS[formZone] : colors.textPrimary }]}>
                {displayValues ? `${displayValues.form > 0 ? '+' : ''}${Math.round(displayValues.form)}` : '-'}
              </Text>
              <Text style={[styles.statSubtext, { color: formZone ? FORM_ZONE_COLORS[formZone] : colors.textSecondary }]}>
                {formZone ? FORM_ZONE_LABELS[formZone] : 'TSB'}
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
        <View style={[styles.chartCard, isDark && styles.cardDark]}>
          {/* Fitness/Fatigue chart */}
          <Text style={[styles.chartTitle, isDark && styles.textLight]}>Fitness & Fatigue</Text>
          <FitnessChart
            data={wellness}
            height={220}
            selectedDate={selectedDate}
            sharedSelectedIdx={sharedSelectedIdx}
            onDateSelect={handleDateSelect}
            onInteractionChange={handleInteractionChange}
          />

          {/* Activity dots chart */}
          <View style={[styles.dotsSection, isDark && styles.sectionDark]}>
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
          <View style={[styles.formSection, isDark && styles.sectionDark]}>
            <Text style={[styles.chartTitle, isDark && styles.textLight]}>Form</Text>
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

        {/* Info section */}
        <View style={[styles.infoCard, isDark && styles.cardDark]}>
          <Text style={[styles.infoTitle, isDark && styles.textLight]}>Understanding the Metrics</Text>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: '#42A5F5' }]} />
            <Text style={[styles.infoText, isDark && styles.textDark]}>
              <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>Fitness</Text> is a 42-day exponentially weighted moving average of your training load.
            </Text>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: '#AB47BC' }]} />
            <Text style={[styles.infoText, isDark && styles.textDark]}>
              <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>Fatigue</Text> is a 7-day exponentially weighted moving average of your training load.
            </Text>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: FORM_ZONE_COLORS.optimal }]} />
            <Text style={[styles.infoText, isDark && styles.textDark]}>
              <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>Form</Text> is fitness minus fatigue. Train in the{' '}
              <Text style={{ color: FORM_ZONE_COLORS.optimal }}>optimal zone</Text> to build fitness. Be{' '}
              <Text style={{ color: FORM_ZONE_COLORS.fresh }}>fresh</Text> for races. Avoid the{' '}
              <Text style={{ color: FORM_ZONE_COLORS.highRisk }}>high risk zone</Text> to prevent overtraining.
            </Text>
          </View>

          <View style={[styles.referencesSection, isDark && styles.referencesSectionDark]}>
            <Text style={[styles.referencesLabel, isDark && styles.textDark]}>Learn more</Text>
            <TouchableOpacity
              onPress={() => WebBrowser.openBrowserAsync('https://intervals.icu/fitness')}
              activeOpacity={0.7}
            >
              <Text style={styles.infoLink}>intervals.icu Fitness Page</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => WebBrowser.openBrowserAsync('https://www.sciencetosport.com/monitoring-training-load/')}
              activeOpacity={0.7}
            >
              <Text style={styles.infoLink}>Monitoring Training Load (Science2Sport)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => WebBrowser.openBrowserAsync('https://www.joefrielsblog.com/2015/12/managing-training-using-tsb.html')}
              activeOpacity={0.7}
            >
              <Text style={styles.infoLink}>Managing Training Using TSB (Joe Friel)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatDisplayDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerLoader: {
    marginLeft: spacing.xs,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
  },
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  statsDate: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  statSubtext: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
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
    paddingVertical: 6,
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
    fontSize: typography.caption.fontSize,
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
  dotsSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: opacity.overlay.medium,
  },
  formSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: opacity.overlay.medium,
  },
  sectionDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  chartTitle: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  infoTitle: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
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
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  infoHighlight: {
    fontWeight: '600',
  },
  infoHighlightDark: {
    color: colors.textOnDark,
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
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoLink: {
    fontSize: typography.caption.fontSize,
    color: colors.primary,
    paddingVertical: spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.error,
  },
});
