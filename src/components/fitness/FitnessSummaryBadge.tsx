import React from 'react';
import { View, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS, type FormZone } from '@/hooks';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';
import type { WellnessData } from '@/types';

interface FitnessSummaryBadgeProps {
  data: WellnessData[] | undefined;
  isLoading?: boolean;
  onPress?: () => void;
}

export function FitnessSummaryBadge({ data, isLoading, onPress }: FitnessSummaryBadgeProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (isLoading) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <Text style={[styles.loadingText, isDark && styles.textLight]}>...</Text>
      </View>
    );
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Get latest data point
  const sortedData = [...data].sort((a, b) => b.id.localeCompare(a.id));
  const latest = sortedData[0];

  const fitnessRaw = latest.ctl ?? latest.ctlLoad ?? 0;
  const fatigueRaw = latest.atl ?? latest.atlLoad ?? 0;
  // Use rounded values for form calculation to match intervals.icu display
  const fitness = Math.round(fitnessRaw);
  const fatigue = Math.round(fatigueRaw);
  const form = fitness - fatigue;
  const formZone = getFormZone(form);

  const zoneColor = FORM_ZONE_COLORS[formZone];

  return (
    <TouchableOpacity
      style={[styles.container, isDark && styles.containerDark]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        <View style={[styles.indicator, { backgroundColor: zoneColor }]} />
        <View style={styles.values}>
          <Text style={[styles.fitnessValue, isDark && styles.textLight]}>
            {fitness}
          </Text>
          <Text style={[styles.formValue, { color: zoneColor }]}>
            {form > 0 ? '+' : ''}{form}
          </Text>
        </View>
        <MaterialCommunityIcons
          name="chevron-down"
          size={16}
          color={isDark ? '#AAA' : '#666'}
        />
      </View>
    </TouchableOpacity>
  );
}

// Compact inline version for the header
export function FitnessSummaryInline({ data }: { data: WellnessData[] | undefined }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (!data || data.length === 0) {
    return null;
  }

  // Get latest data point
  const sortedData = [...data].sort((a, b) => b.id.localeCompare(a.id));
  const latest = sortedData[0];

  const fitnessRaw = latest.ctl ?? latest.ctlLoad ?? 0;
  const fatigueRaw = latest.atl ?? latest.atlLoad ?? 0;
  // Use rounded values for form calculation to match intervals.icu display
  const fitness = Math.round(fitnessRaw);
  const fatigue = Math.round(fatigueRaw);
  const form = fitness - fatigue;
  const formZone = getFormZone(form);
  const zoneColor = FORM_ZONE_COLORS[formZone];

  return (
    <View style={[styles.inlineContainer, isDark && styles.inlineContainerDark]}>
      <View style={styles.inlineRow}>
        <Text style={[styles.inlineLabel, isDark && styles.textDark]}>Fit</Text>
        <Text style={[styles.inlineValue, { color: colors.fitness }]}>{fitness}</Text>
      </View>
      <View style={[styles.inlineDivider, isDark && styles.inlineDividerDark]} />
      <View style={styles.inlineRow}>
        <Text style={[styles.inlineLabel, isDark && styles.textDark]}>Fat</Text>
        <Text style={[styles.inlineValue, { color: colors.chartPurple }]}>{fatigue}</Text>
      </View>
      <View style={[styles.inlineDivider, isDark && styles.inlineDividerDark]} />
      <View style={styles.inlineRow}>
        <Text style={[styles.inlineLabel, isDark && styles.textDark]}>Form</Text>
        <Text style={[styles.inlineValue, { color: zoneColor }]}>
          {form > 0 ? '+' : ''}{form}
        </Text>
      </View>
      <View style={[styles.zoneIndicator, { backgroundColor: zoneColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: opacity.overlay.light,
    borderRadius: 20,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
  },
  containerDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  values: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  fitnessValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  formValue: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  loadingText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  // Inline styles
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: opacity.overlay.light,
    borderRadius: spacing.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  inlineContainerDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  inlineRow: {
    alignItems: 'center',
  },
  inlineLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    marginBottom: 1,
  },
  inlineValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
  },
  inlineDivider: {
    width: 1,
    height: 24,
    backgroundColor: opacity.overlay.medium,
    marginHorizontal: spacing.sm,
  },
  inlineDividerDark: {
    backgroundColor: opacity.overlayDark.heavy,
  },
  zoneIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: spacing.xs,
  },
});
