import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { SharedValue } from 'react-native-reanimated';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import type { WellnessData, Activity } from '@/types';
import { FitnessChart, FormZoneChart, ActivityDotsChart } from '..';
import { useEftpChanges } from '../../hooks/useEftpChanges';

interface FitnessChartCardProps {
  wellness: WellnessData[];
  activities: Activity[];
  selectedDate: string | null;
  sharedSelectedIdx: SharedValue<number>;
  onDateSelect: (
    date: string | null,
    values: { fitness: number; fatigue: number; form: number } | null
  ) => void;
  onInteractionChange: (isInteracting: boolean) => void;
}

export const FitnessChartCard = React.memo(function FitnessChartCard({
  wellness,
  activities,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
}: FitnessChartCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const markers = useEftpChanges();

  return (
    <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
      {/* Fitness/Fatigue chart */}
      <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>
        {t('fitnessScreen.fitnessAndFatigue')}
      </Text>
      <FitnessChart
        data={wellness}
        markers={markers}
        height={220}
        selectedDate={selectedDate}
        sharedSelectedIdx={sharedSelectedIdx}
        onDateSelect={onDateSelect}
        onInteractionChange={onInteractionChange}
      />

      <View
        testID="fitness-activity-dots"
        style={[styles.dotsSection, isDark && styles.dotsSectionDark]}
      >
        <ActivityDotsChart
          data={wellness}
          activities={activities}
          height={32}
          selectedDate={selectedDate}
          sharedSelectedIdx={sharedSelectedIdx}
          onDateSelect={onDateSelect}
          onInteractionChange={onInteractionChange}
        />
      </View>

      <View
        testID="fitness-form-zone-chart"
        style={[styles.formSection, isDark && styles.formSectionDark]}
      >
        <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>
          {t('metrics.form')}
        </Text>
        <FormZoneChart
          data={wellness}
          height={140}
          selectedDate={selectedDate}
          sharedSelectedIdx={sharedSelectedIdx}
          onDateSelect={onDateSelect}
          onInteractionChange={onInteractionChange}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  chartCardDark: {
    backgroundColor: darkColors.surface,
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
});
