import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme, FORM_ZONE_COLORS, FORM_ZONE_LABELS } from '@/hooks';
import { formatShortDateWithWeekday } from '@/lib';
import type { FormZone } from '@/lib/algorithms/fitness';
import { colors, darkColors, spacing, layout, typography } from '@/theme';

interface FitnessDisplayValues {
  fitness: number;
  fatigue: number;
  form: number;
}

interface FitnessHeaderStatsProps {
  displayDate: string | null | undefined;
  displayValues: FitnessDisplayValues | null;
  formZone: FormZone | null;
  isDark: boolean;
  /** Ramp rate from intervals.icu wellness payload. */
  rampRate?: number | null;
}

/**
 * Three-column Fitness / Fatigue / Form stats card displayed at the top of the
 * fitness screen. When a point is selected on a chart, `displayDate` and
 * `displayValues` reflect that selection; otherwise they hold the current
 * wellness snapshot.
 *
 * The Form column dynamically tints its value and subtext with the form-zone
 * color (`FORM_ZONE_COLORS[formZone]`) and swaps the subtext label between the
 * TSB fallback and the zone's localized label (`FORM_ZONE_LABELS[formZone]`).
 */
export const FitnessHeaderStats = React.memo(function FitnessHeaderStats({
  displayDate,
  displayValues,
  formZone,
  isDark,
  rampRate,
}: FitnessHeaderStatsProps) {
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();

  return (
    <View style={[styles.statsCard, isDark && styles.statsCardDark]}>
      <Text style={[styles.statsDate, isDark && styles.statsDateDark]}>
        {displayDate ? formatShortDateWithWeekday(displayDate) : t('fitnessScreen.current')}
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

      {rampRate != null && (
        <View style={[styles.secondaryRow, isDark && styles.secondaryRowDark]}>
          <View style={styles.secondaryItem}>
            <Text style={[styles.secondaryLabel, isDark && styles.statSubtextDark]}>
              {t('fitnessScreen.rampRate')}
            </Text>
            <Text
              style={[
                styles.secondaryValue,
                { color: rampRate >= 0 ? colors.fitnessBlue : colors.fatiguePurple },
              ]}
            >
              {`${rampRate > 0 ? '+' : ''}${rampRate.toFixed(1)}`}
            </Text>
            <Text style={[styles.secondaryHint, isDark && styles.statSubtextDark]}>
              {t('fitnessScreen.perWeek')}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
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
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  secondaryRowDark: {
    borderTopColor: darkColors.borderLight,
  },
  secondaryItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  secondaryLabel: {
    ...typography.micro,
    color: colors.textSecondary,
  },
  secondaryValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryHint: {
    ...typography.micro,
    color: colors.textSecondary,
  },
});
