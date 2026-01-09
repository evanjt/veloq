import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';

interface DecouplingChartProps {
  /** Power or pace data */
  power?: number[];
  /** Heart rate data */
  heartrate?: number[];
  /** Height of the chart area */
  height?: number;
}

function calculateDecoupling(
  power: number[],
  heartrate: number[]
): {
  firstHalfEf: number;
  secondHalfEf: number;
  decoupling: number;
  isGood: boolean;
} {
  const midpoint = Math.floor(power.length / 2);

  // Calculate efficiency (power/HR) for each half
  const firstHalfPower = power.slice(0, midpoint);
  const firstHalfHR = heartrate.slice(0, midpoint);
  const secondHalfPower = power.slice(midpoint);
  const secondHalfHR = heartrate.slice(midpoint);

  const avgFirstPower = firstHalfPower.reduce((a, b) => a + b, 0) / firstHalfPower.length;
  const avgFirstHR = firstHalfHR.reduce((a, b) => a + b, 0) / firstHalfHR.length;
  const avgSecondPower = secondHalfPower.reduce((a, b) => a + b, 0) / secondHalfPower.length;
  const avgSecondHR = secondHalfHR.reduce((a, b) => a + b, 0) / secondHalfHR.length;

  const firstHalfEf = avgFirstPower / avgFirstHR;
  const secondHalfEf = avgSecondPower / avgSecondHR;

  // Decoupling percentage: how much efficiency dropped
  const decoupling = ((firstHalfEf - secondHalfEf) / firstHalfEf) * 100;

  // < 5% decoupling is considered good aerobic fitness
  const isGood = decoupling < 5;

  return { firstHalfEf, secondHalfEf, decoupling, isGood };
}

export function DecouplingChart({ power, heartrate, height = 150 }: DecouplingChartProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // All hooks must be called before any conditional returns
  const analysis = useMemo(() => {
    if (!power || !heartrate || power.length === 0 || heartrate.length === 0) {
      return { firstHalfEf: 0, secondHalfEf: 0, decoupling: 0, isGood: true };
    }
    return calculateDecoupling(power, heartrate);
  }, [power, heartrate]);

  const midpoint = useMemo(() => {
    if (!power) return 0;
    return Math.floor(power.length / 2);
  }, [power]);

  // Show empty state if no data
  if (!power || !heartrate || power.length === 0 || heartrate.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('stats.aerobicDecoupling')}
          </Text>
        </View>
        <View style={[styles.emptyState, { height }]}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            {t('stats.noDecouplingData')}
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            {t('stats.completeDecouplingHint')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>
          {t('stats.aerobicDecoupling')}
        </Text>
        <Text
          style={[
            styles.decouplingValue,
            { color: analysis.isGood ? colors.success : colors.warning },
          ]}
        >
          {analysis.decoupling.toFixed(1)}%
        </Text>
      </View>

      {/* Status indicator */}
      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: analysis.isGood ? colors.success : colors.warning,
            },
          ]}
        >
          <Text style={styles.statusText}>
            {analysis.isGood ? t('stats.goodAerobicFitness') : t('stats.needsImprovement')}
          </Text>
        </View>
        <Text style={[styles.targetText, isDark && styles.textDark]}>
          {t('stats.targetLessThan5')}
        </Text>
      </View>

      {/* Mini chart visualization */}
      <View style={[styles.chartContainer, { height }]}>
        {/* First half */}
        <View style={[styles.halfSection, styles.firstHalf]}>
          <Text style={[styles.halfLabel, isDark && styles.textDark]}>{t('stats.firstHalf')}</Text>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>{t('stats.avgPower')}</Text>
            <Text style={[styles.dataValue, isDark && styles.textLight]}>
              {Math.round(power.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint)}W
            </Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>{t('stats.avgHr')}</Text>
            <Text style={[styles.dataValue, isDark && styles.textLight]}>
              {Math.round(heartrate.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint)} bpm
            </Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>
              {t('stats.efficiency')}
            </Text>
            <Text style={[styles.dataValue, { color: colors.primary }]}>
              {analysis.firstHalfEf.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Divider with arrow */}
        <View style={styles.divider}>
          <View style={[styles.dividerLine, isDark && styles.dividerLineDark]} />
          <Text style={styles.arrow}>→</Text>
          <View style={[styles.dividerLine, isDark && styles.dividerLineDark]} />
        </View>

        {/* Second half */}
        <View style={[styles.halfSection, styles.secondHalf]}>
          <Text style={[styles.halfLabel, isDark && styles.textDark]}>{t('stats.secondHalf')}</Text>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>{t('stats.avgPower')}</Text>
            <Text style={[styles.dataValue, isDark && styles.textLight]}>
              {Math.round(
                power.slice(midpoint).reduce((a, b) => a + b, 0) / (power.length - midpoint)
              )}
              W
            </Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>{t('stats.avgHr')}</Text>
            <Text style={[styles.dataValue, isDark && styles.textLight]}>
              {Math.round(
                heartrate.slice(midpoint).reduce((a, b) => a + b, 0) / (heartrate.length - midpoint)
              )}{' '}
              bpm
            </Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>
              {t('stats.efficiency')}
            </Text>
            <Text
              style={[
                styles.dataValue,
                { color: analysis.isGood ? colors.primary : colors.warning },
              ]}
            >
              {analysis.secondHalfEf.toFixed(2)}
            </Text>
          </View>
        </View>
      </View>

      {/* Explanation */}
      <Text style={[styles.explanation, isDark && styles.textDark]}>
        {t('stats.decouplingExplanation')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  decouplingValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
  },
  statusText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textOnDark,
  },
  targetText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  halfSection: {
    flex: 1,
    padding: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    borderRadius: layout.borderRadiusSm,
  },
  firstHalf: {
    marginRight: spacing.xs,
  },
  secondHalf: {
    marginLeft: spacing.xs,
  },
  halfLabel: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  dataLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  dataValue: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  divider: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  dividerLine: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  dividerLineDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  arrow: {
    fontSize: typography.body.fontSize,
    color: colors.textSecondary,
    marginVertical: spacing.xs,
  },
  explanation: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
});
