import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { getSportDisplayName } from '@/hooks/insights/sectionClusterInsights';
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
        matters:
          'Repeatable sections can highlight durable performance shifts that stick across efforts.',
        next: 'Route detail stores the effort list and timing for the PR.',
      };
    case 'tsb_form':
      return {
        changed: 'The gap between fatigue and fitness moved.',
        matters: 'TSB is a loose summary of whether load is stacking or freshness is returning.',
        next: 'Fitness charts keep TSB, CTL, and ATL in view for context.',
      };
    case 'hrv_trend':
      return {
        changed: 'Short-term recovery readings nudged up or down.',
        matters:
          'HRV is most interpretable as a trend alongside sleep, resting HR, and recent loading.',
        next: 'Fitness shows whether the HRV shift lines up with those other markers.',
      };
    case 'period_comparison':
      return {
        changed: 'Weekly load landed differently than the week before.',
        matters:
          'Week-over-week swings often explain why training feels easier, flatter, or more fatiguing.',
        next: 'Route workspace documents which sessions changed from one week to the next.',
      };
    case 'fitness_milestone':
      return {
        changed: isPowerMilestone
          ? 'Your FTP estimate moved upward.'
          : isSwimMilestone
            ? 'Your threshold swim speed moved upward, which shows up as faster pace per 100m.'
            : 'Your running threshold speed moved upward, which shows up as faster pace per kilometre.',
        matters: isPowerMilestone
          ? 'Power shifts are most useful when they also show up in repeatable climbs, intervals, and longer steady work.'
          : isSwimMilestone
            ? 'Swim threshold changes are most useful when they also show up in repeatable sets and longer steady work.'
            : 'Running threshold changes are most useful when they also show up in repeatable sections and controlled hard sessions.',
        next: isPowerMilestone
          ? 'Fitness keeps the FTP trend and ride context close by.'
          : isSwimMilestone
            ? 'Fitness keeps the swim threshold trend close by for comparison.'
            : 'Fitness keeps the running threshold trend close by for comparison.',
      };
    case 'strength_progression':
      return {
        changed: "A muscle group's weighted-set volume moved compared to earlier weeks.",
        matters: 'Weighted-set trends capture how lifting focus distributes across the month.',
        next: 'Strength retains the 4-week history for each muscle to double-check the shift.',
      };
    case 'strength_balance':
      return {
        changed: 'An antagonist pair shows one side carrying more weighted sets.',
        matters: 'The ratio highlights where the volume split sits between the two sides.',
        next: 'Strength lists the pair totals so you can see how far apart they are.',
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
        matters:
          'That timing cross-check can highlight repeat sections whose bests may no longer match the broader fitness trend.',
        next: stalePrIsGrouped
          ? 'The sections tab keeps the candidate sections and best times together.'
          : 'Section detail keeps the repeat efforts and timing together.',
      };
    case 'section_cluster':
      return {
        changed: singleSportLabel
          ? `Several ${singleSportLabel} sections are moving in sync.`
          : 'Several repeat sections are moving in sync.',
        matters: singleSportLabel
          ? `When more than one repeat ${singleSportLabel} section shifts the same way, the pattern is easier to trust than a single outlier.`
          : 'When more than one repeat section shifts the same way, the pattern is easier to trust than a single outlier.',
        next: 'The sections tab keeps the grouped efforts side by side.',
      };
    case 'efficiency_trend':
      return {
        changed: 'Matched efforts on this section now show a lower heart-rate cost.',
        matters:
          'This pattern is easier to trust when it repeats across familiar efforts rather than one isolated pass.',
        next: 'Section detail keeps the underlying efforts and heart-rate context together.',
      };
    case 'intensity_context':
      return {
        changed: 'This week’s load shows a defined intensity shape.',
        matters:
          'Session count can hide whether the week felt hard due to volume, density, or repeated hard work.',
        next: 'Health juxtaposes training pattern with wellness and recovery markers for context.',
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
