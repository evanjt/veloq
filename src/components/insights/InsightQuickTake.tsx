import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
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

function buildQuickTake(insight: Insight): QuickTakeContent | null {
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
        changed: 'A threshold marker nudged upward.',
        matters:
          'Threshold shifts change the way pacing, power, and effort appear across key sessions.',
        next: 'Fitness keeps the source trend handy for reference.',
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
        changed: 'Current fitness now outpaces when this PR was set.',
        matters:
          'That rate change is a concrete way to see how gains translate outside aggregate metrics.',
        next: 'Section detail lists recent traversals for a quick glance.',
      };
    case 'section_cluster':
      return {
        changed: 'Several repeat sections are moving in sync.',
        matters: 'Clustered shifts often point to a broader pattern rather than a single outlier.',
        next: 'The route workspace calls out the grouped sections and the efforts behind them.',
      };
    case 'efficiency_trend':
      return {
        changed: 'This terrain now matches with less cardiovascular cost.',
        matters: 'Lower HR at a familiar pace usually signals an efficiency gain over time.',
        next: 'Section detail keeps the multiple efforts needed to confirm the trend.',
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
    <View style={[styles.card, isDark && styles.cardDark]}>
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
