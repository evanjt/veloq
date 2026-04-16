import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { SharedValue } from 'react-native-reanimated';
import { FitnessChart, FormZoneChart, ActivityDotsChart } from '@/components/fitness';
import { useTheme, FORM_ZONE_COLORS } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import type { WellnessData, Activity } from '@/types';
import type { FormZone } from '@/lib/algorithms/fitness';

interface FitnessChartCardProps {
  wellness: WellnessData[];
  activities: Activity[];
  chartsReady: boolean;
  selectedDate: string | null;
  sharedSelectedIdx: SharedValue<number>;
  formZone: FormZone | null;
  onDateSelect: (
    date: string | null,
    values: { fitness: number; fatigue: number; form: number } | null
  ) => void;
  onInteractionChange: (isInteracting: boolean) => void;
}

export const FitnessChartCard = React.memo(function FitnessChartCard({
  wellness,
  activities,
  chartsReady,
  selectedDate,
  sharedSelectedIdx,
  formZone,
  onDateSelect,
  onInteractionChange,
}: FitnessChartCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
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
        onDateSelect={onDateSelect}
        onInteractionChange={onInteractionChange}
      />

      {/* Activity dots chart - deferred to reduce simultaneous shader compilation */}
      {chartsReady && (
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
      )}

      {/* Form zone chart - deferred to reduce simultaneous shader compilation */}
      {chartsReady && (
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
          {/* Contextual form zone guidance */}
          {formZone && (
            <View
              style={[
                styles.guidanceCard,
                isDark && styles.guidanceCardDark,
                { borderLeftColor: FORM_ZONE_COLORS[formZone] },
              ]}
            >
              <Text style={[styles.guidanceText, isDark && styles.guidanceTextDark]}>
                {t(`fitnessScreen.guidance.${formZone}` as never)}
              </Text>
            </View>
          )}
        </View>
      )}
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
  guidanceCard: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  guidanceCardDark: {
    backgroundColor: darkColors.surface,
  },
  guidanceText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  guidanceTextDark: {
    color: darkColors.textSecondary,
  },
});
