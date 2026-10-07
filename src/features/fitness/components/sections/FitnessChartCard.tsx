import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { SharedValue } from 'react-native-reanimated';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography, opacity } from '@/theme';
import { Card } from '@/shared/ui/Card';
import type { DayLoad } from 'veloqrs';
import type { WellnessData, Activity } from '@/types';
import { FitnessChart, FormZoneChart, ActivityDotsChart } from '..';
import type { EftpChange } from '../../lib/eftpChanges';

interface FitnessChartCardProps {
  wellness: WellnessData[];
  activities: Activity[];
  dailyLoads: DayLoad[];
  /** The activities that moved the accepted eFTP, marked on the fitness plot. */
  eftpChanges: EftpChange[];
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
  dailyLoads,
  eftpChanges,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
}: FitnessChartCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
    <View style={styles.chartFrame}>
      <Card variant="flat">
        {/* Fitness/Fatigue chart */}
        <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>
          {t('fitnessScreen.fitnessAndFatigue')}
        </Text>
        <FitnessChart
          data={wellness}
          markers={eftpChanges}
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
            dailyLoads={dailyLoads}
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
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  chartFrame: {
    marginBottom: spacing.md,
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
