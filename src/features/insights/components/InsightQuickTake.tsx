import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { getSportDisplayName } from '@/lib';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';
import type { TFunction } from 'i18next';

interface InsightQuickTakeProps {
  insight: Insight;
}

interface QuickTakeContent {
  changed: string;
  matters: string;
  next: string;
}

function getSingleSportLabel(insight: Insight): string | null {
  const uniqueSports = Array.from(
    new Set(
      (insight.supportingData?.sections ?? [])
        .map((section) => section.sportType)
        .filter(
          (sportType): sportType is string => typeof sportType === 'string' && sportType.length > 0
        )
    )
  );

  if (uniqueSports.length !== 1) return null;
  return getSportDisplayName(uniqueSports[0]);
}

function getStalePrMetricContext(insight: Insight): 'power' | 'running' | 'swimming' | 'generic' {
  const units = new Set(
    (insight.supportingData?.dataPoints ?? [])
      .map((dataPoint) => dataPoint.unit)
      .filter((unit): unit is string => typeof unit === 'string' && unit.length > 0)
  );

  const labels = (insight.supportingData?.dataPoints ?? []).map((dataPoint) =>
    dataPoint.label.toLowerCase()
  );

  if (labels.some((label) => label.includes('ftp')) || units.has('W')) {
    return 'power';
  }
  if (units.has('/100m')) {
    return 'swimming';
  }

  const sportLabel = getSingleSportLabel(insight);
  if (sportLabel === 'running' || sportLabel === 'trail running') {
    return 'running';
  }
  if (sportLabel === 'swimming') {
    return 'swimming';
  }

  return units.has('/km') ? 'running' : 'generic';
}

function buildQuickTake(insight: Insight, t: TFunction): QuickTakeContent | null {
  const currentMetricUnit = insight.supportingData?.dataPoints?.[0]?.unit;
  const isPowerMilestone = currentMetricUnit === 'W';
  const isSwimMilestone = currentMetricUnit === '/100m';
  const stalePrMetricContext = getStalePrMetricContext(insight);
  const stalePrIsGrouped = (insight.supportingData?.sections?.length ?? 0) > 1;

  switch (insight.category) {
    case 'section_pr':
      return {
        changed: t('insights.quickTake.sectionPr.changed'),
        matters: t('insights.quickTake.sectionPr.matters'),
        next: t('insights.quickTake.sectionPr.next'),
      };
    case 'hrv_trend':
      return {
        changed: t('insights.quickTake.hrvTrend.changed'),
        matters: t('insights.quickTake.hrvTrend.matters'),
        next: t('insights.quickTake.hrvTrend.next'),
      };
    case 'period_comparison':
      return {
        changed: t('insights.quickTake.periodComparison.changed'),
        matters: t('insights.quickTake.periodComparison.matters'),
        next: t('insights.quickTake.periodComparison.next'),
      };
    case 'fitness_milestone':
      return {
        changed: isPowerMilestone
          ? t('insights.quickTake.fitnessMilestone.changedFtp')
          : isSwimMilestone
            ? t('insights.quickTake.fitnessMilestone.changedSwimPace')
            : t('insights.quickTake.fitnessMilestone.changedRunPace'),
        matters: isPowerMilestone
          ? t('insights.quickTake.fitnessMilestone.mattersFtp')
          : t('insights.quickTake.fitnessMilestone.mattersPace'),
        next: isPowerMilestone
          ? t('insights.quickTake.fitnessMilestone.nextFtp')
          : t('insights.quickTake.fitnessMilestone.nextPace'),
      };
    case 'strength_progression':
      return {
        changed: t('insights.quickTake.strengthProgression.changed'),
        matters: t('insights.quickTake.strengthProgression.matters'),
        next: t('insights.quickTake.strengthProgression.next'),
      };
    case 'strength_balance':
      return {
        changed: t('insights.quickTake.strengthBalance.changed'),
        matters: t('insights.quickTake.strengthBalance.matters'),
        next: t('insights.quickTake.strengthBalance.next'),
      };
    case 'stale_pr':
      return {
        changed:
          stalePrMetricContext === 'power'
            ? t(
                stalePrIsGrouped
                  ? 'insights.quickTake.stalePr.changedPowerGrouped'
                  : 'insights.quickTake.stalePr.changedPowerSingle'
              )
            : stalePrMetricContext === 'swimming'
              ? t(
                  stalePrIsGrouped
                    ? 'insights.quickTake.stalePr.changedSwimGrouped'
                    : 'insights.quickTake.stalePr.changedSwimSingle'
                )
              : stalePrMetricContext === 'running'
                ? t(
                    stalePrIsGrouped
                      ? 'insights.quickTake.stalePr.changedRunGrouped'
                      : 'insights.quickTake.stalePr.changedRunSingle'
                  )
                : t(
                    stalePrIsGrouped
                      ? 'insights.quickTake.stalePr.changedGenericGrouped'
                      : 'insights.quickTake.stalePr.changedGenericSingle'
                  ),
        matters: t('insights.quickTake.stalePr.matters'),
        next: t(
          stalePrIsGrouped
            ? 'insights.quickTake.stalePr.nextGrouped'
            : 'insights.quickTake.stalePr.nextSingle'
        ),
      };
    case 'efficiency_trend':
      return {
        changed: t('insights.quickTake.efficiencyTrend.changed'),
        matters: t('insights.quickTake.efficiencyTrend.matters'),
        next: t('insights.quickTake.efficiencyTrend.next'),
      };
    default:
      return null;
  }
}

export const InsightQuickTake = React.memo(function InsightQuickTake({
  insight,
}: InsightQuickTakeProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const content = useMemo(() => buildQuickTake(insight, t), [insight, t]);

  if (!content) return null;

  return (
    <View testID="insight-quick-take" style={[styles.card, isDark && styles.cardDark]}>
      <Text style={[styles.heading, isDark && styles.headingDark]}>
        {t('insights.quickTake.title')}
      </Text>

      <View style={styles.row}>
        <Text style={[styles.label, isDark && styles.labelDark]}>
          {t('insights.quickTake.whatChanged')}
        </Text>
        <Text style={[styles.body, isDark && styles.bodyDark]}>{content.changed}</Text>
      </View>

      <View style={styles.row}>
        <Text style={[styles.label, isDark && styles.labelDark]}>
          {t('insights.quickTake.whyItMatters')}
        </Text>
        <Text style={[styles.body, isDark && styles.bodyDark]}>{content.matters}</Text>
      </View>

      <View style={styles.row}>
        <Text style={[styles.label, isDark && styles.labelDark]}>
          {t('insights.quickTake.nextLook')}
        </Text>
        <Text style={[styles.body, isDark && styles.bodyDark]}>{content.next}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: opacity.overlay.subtle,
    gap: spacing.sm,
  },
  cardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  heading: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headingDark: {
    color: darkColors.textPrimary,
  },
  row: {
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  bodyDark: {
    color: darkColors.textPrimary,
  },
});
