import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FitnessChart, FormZoneChart } from '@/components/fitness';
import { useWellness, getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS, type TimeRange } from '@/hooks';
import { colors, spacing, layout, typography } from '@/theme';

const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: '7d', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
];

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

  const { data: wellness, isLoading, isError, refetch } = useWellness(timeRange);

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

  if (isLoading) {
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
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>Fitness & Form</Text>
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

        {/* Fitness/Fatigue chart */}
        <View style={[styles.chartCard, isDark && styles.cardDark]}>
          <Text style={[styles.chartTitle, isDark && styles.textLight]}>Fitness & Fatigue</Text>
          <FitnessChart
            data={wellness}
            height={220}
            onDateSelect={handleDateSelect}
            onInteractionChange={handleInteractionChange}
          />
        </View>

        {/* Form zone chart */}
        <View style={[styles.chartCard, isDark && styles.cardDark]}>
          <Text style={[styles.chartTitle, isDark && styles.textLight]}>Form (Training Stress Balance)</Text>
          <FormZoneChart
            data={wellness}
            height={140}
            onDateSelect={handleDateSelect}
            onInteractionChange={handleInteractionChange}
          />
        </View>

        {/* Info section */}
        <View style={[styles.infoCard, isDark && styles.cardDark]}>
          <Text style={[styles.infoTitle, isDark && styles.textLight]}>Understanding the Metrics</Text>
          <View style={styles.infoItem}>
            <View style={[styles.infoDot, { backgroundColor: '#42A5F5' }]} />
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, isDark && styles.textLight]}>Fitness (CTL)</Text>
              <Text style={[styles.infoText, isDark && styles.textDark]}>
                42-day exponentially weighted average of training load. Higher = more fit.
              </Text>
            </View>
          </View>
          <View style={styles.infoItem}>
            <View style={[styles.infoDot, { backgroundColor: '#AB47BC' }]} />
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, isDark && styles.textLight]}>Fatigue (ATL)</Text>
              <Text style={[styles.infoText, isDark && styles.textDark]}>
                7-day exponentially weighted average of training load. Higher = more tired.
              </Text>
            </View>
          </View>
          <View style={styles.infoItem}>
            <View style={[styles.infoDot, { backgroundColor: FORM_ZONE_COLORS.optimal }]} />
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, isDark && styles.textLight]}>Form (TSB)</Text>
              <Text style={[styles.infoText, isDark && styles.textDark]}>
                Fitness minus Fatigue. Negative = building fitness. Positive = fresh/recovered.
              </Text>
            </View>
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
  textDark: {
    color: '#AAA',
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
    backgroundColor: '#1E1E1E',
  },
  statsDate: {
    fontSize: 12,
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
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  statSubtext: {
    fontSize: 10,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  timeRangeButtonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeRangeTextDark: {
    color: '#AAA',
  },
  timeRangeTextActive: {
    color: '#FFFFFF',
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  chartTitle: {
    fontSize: 14,
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
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  infoItem: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  infoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    marginRight: spacing.sm,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  infoText: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
  },
});
