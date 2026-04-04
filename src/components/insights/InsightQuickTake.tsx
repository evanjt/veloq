import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { getSportDisplayName } from '@/lib';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

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

function buildQuickTake(insight: Insight): QuickTakeContent | null {
  const currentMetricUnit = insight.supportingData?.dataPoints?.[0]?.unit;
  const isPowerMilestone = currentMetricUnit === 'W';
  const isSwimMilestone = currentMetricUnit === '/100m';
  const singleSportLabel = getSingleSportLabel(insight);
  const stalePrMetricContext = getStalePrMetricContext(insight);
  const stalePrIsGrouped = (insight.supportingData?.sections?.length ?? 0) > 1;

  switch (insight.category) {
    case 'section_pr':
      return {
        changed: 'A repeatable route now carries a new best.',
        matters: 'Compares this effort against all previous times on the same section.',
        next: 'Route detail stores the effort list and timing.',
      };
    case 'hrv_trend':
      return {
        changed: 'Short-term recovery readings nudged up or down.',
        matters: 'Shows the direction of your 7-day HRV rolling average.',
        next: 'Fitness tab shows HRV alongside other wellness data.',
      };
    case 'period_comparison':
      return {
        changed: 'Weekly load landed differently than the week before.',
        matters: "Compares this week's load against the previous week.",
        next: 'Routes tab lists the activities from both weeks.',
      };
    case 'fitness_milestone':
      return {
        changed: isPowerMilestone
          ? 'Your FTP estimate moved upward.'
          : isSwimMilestone
            ? 'Your threshold swim speed moved upward, which shows up as faster pace per 100m.'
            : 'Your running threshold speed moved upward, which shows up as faster pace per kilometre.',
        matters: isPowerMilestone
          ? 'Tracks the difference between your latest and previous FTP estimates.'
          : 'Tracks the difference between your latest and previous threshold pace estimates.',
        next: isPowerMilestone
          ? 'Fitness tab shows the FTP trend over time.'
          : 'Fitness tab shows the pace trend over time.',
      };
    case 'strength_progression':
      return {
        changed: "A muscle group's weighted-set volume moved compared to earlier weeks.",
        matters: 'Compares weighted-set volume in the recent 2 weeks against the earlier 2 weeks.',
        next: 'Strength tab shows the 4-week history per muscle group.',
      };
    case 'strength_balance':
      return {
        changed: 'An antagonist pair shows one side carrying more weighted sets.',
        matters: 'Shows the weighted-set ratio between antagonist muscle pairs over 4 weeks.',
        next: 'Strength tab shows the pair totals side by side.',
      };
    case 'stale_pr':
      return {
        changed:
          stalePrMetricContext === 'power'
            ? stalePrIsGrouped
              ? 'Current cycling power now sits above the level tied to several section bests.'
              : 'Current cycling power now sits above the level tied to this section best.'
            : stalePrMetricContext === 'swimming'
              ? stalePrIsGrouped
                ? 'Current swim threshold now sits above the level tied to several section bests.'
                : 'Current swim threshold now sits above the level tied to this section best.'
              : stalePrMetricContext === 'running'
                ? stalePrIsGrouped
                  ? 'Current running threshold now sits above the level tied to several section bests.'
                  : 'Current running threshold now sits above the level tied to this section best.'
                : stalePrIsGrouped
                  ? 'Current fitness now sits above the level tied to several section bests.'
                  : 'Current fitness now sits above the level tied to this section best.',
        matters: 'Cross-references fitness trend dates against section PR dates.',
        next: stalePrIsGrouped
          ? 'Sections tab lists the flagged sections.'
          : 'Section detail shows the effort history.',
      };
    case 'efficiency_trend':
      return {
        changed: 'Matched efforts on this section now show a lower heart-rate cost.',
        matters: 'Tracks the HR/pace ratio across matched efforts on this section over time.',
        next: 'Section detail shows the individual efforts and HR data.',
      };
    default:
      return null;
  }
}

export const InsightQuickTake = React.memo(function InsightQuickTake({
  insight,
}: InsightQuickTakeProps) {
  const { isDark } = useTheme();
  const content = useMemo(() => buildQuickTake(insight), [insight]);

  if (!content) return null;

  return (
    <View testID="insight-quick-take" style={[styles.card, isDark && styles.cardDark]}>
      <Text style={[styles.heading, isDark && styles.headingDark]}>Quick Take</Text>

      <View style={styles.row}>
        <Text style={[styles.label, isDark && styles.labelDark]}>What changed</Text>
        <Text style={[styles.body, isDark && styles.bodyDark]}>{content.changed}</Text>
      </View>

      <View style={styles.row}>
        <Text style={[styles.label, isDark && styles.labelDark]}>Why it matters</Text>
        <Text style={[styles.body, isDark && styles.bodyDark]}>{content.matters}</Text>
      </View>

      <View style={styles.row}>
        <Text style={[styles.label, isDark && styles.labelDark]}>Next look</Text>
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
