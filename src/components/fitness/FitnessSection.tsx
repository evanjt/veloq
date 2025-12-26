import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FitnessChart } from './FitnessChart';
import { FormZoneChart } from './FormZoneChart';
import { useWellness, type TimeRange } from '@/hooks';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';

const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '1m', label: '1 month' },
  { id: '42d', label: '42 days' },
  { id: '3m', label: '3 months' },
  { id: '6m', label: '6 months' },
  { id: '1y', label: '1 year' },
];

interface FitnessSectionProps {
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function FitnessSection({ expanded = true, onToggleExpand }: FitnessSectionProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [timeRange, setTimeRange] = useState<TimeRange>('3m');

  const { data: wellness, isLoading, isError } = useWellness(timeRange);

  if (!expanded) {
    return null;
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Section header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <MaterialCommunityIcons
            name="chart-line"
            size={20}
            color={isDark ? '#FFF' : colors.textPrimary}
          />
          <Text style={[styles.title, isDark && styles.textLight]}>Fitness & Form</Text>
        </View>
        {onToggleExpand && (
          <TouchableOpacity onPress={onToggleExpand} style={styles.expandButton}>
            <MaterialCommunityIcons
              name="chevron-up"
              size={24}
              color={isDark ? '#AAA' : '#666'}
            />
          </TouchableOpacity>
        )}
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

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingText, isDark && styles.textDark]}>
            Loading fitness data...
          </Text>
        </View>
      ) : isError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load fitness data</Text>
        </View>
      ) : wellness && wellness.length > 0 ? (
        <>
          {/* Main fitness chart (CTL/ATL) */}
          <View style={styles.chartContainer}>
            <FitnessChart data={wellness} height={180} />
          </View>

          {/* Form zone chart */}
          <View style={[styles.formChartContainer, isDark && styles.formChartContainerDark]}>
            <Text style={[styles.formTitle, isDark && styles.textLight]}>Form (TSB)</Text>
            <FormZoneChart data={wellness} height={100} />
          </View>
        </>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No fitness data available
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  expandButton: {
    padding: 4,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  timeRangeButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
  },
  timeRangeButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeRangeTextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeTextActive: {
    color: colors.textOnDark,
  },
  chartContainer: {
    marginBottom: spacing.md,
  },
  formChartContainer: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusSm,
    padding: spacing.sm,
  },
  formChartContainerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  formTitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  loadingContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  errorContainer: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: typography.caption.fontSize,
    color: colors.error,
  },
  emptyContainer: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
});
