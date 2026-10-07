import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography } from '@/theme';
import {
  rankingFactors,
  type ImprovementBasisKind,
  type RankingFactor,
  type RankingFactorKind,
} from '../lib/rankingFactors';
import type { SectionRankingScores } from '../types';

const LABELS = {
  recency: 'insights.ranking.recency.label',
  improvement: 'insights.ranking.improvement.label',
  anomaly: 'insights.ranking.anomaly.label',
  engagement: 'insights.ranking.engagement.label',
} as const satisfies Record<RankingFactorKind, string>;

const EXPLANATIONS = {
  recency: 'insights.ranking.recency.explanation',
  anomaly: 'insights.ranking.anomaly.explanation',
  engagement: 'insights.ranking.engagement.explanation',
} as const satisfies Record<Exclude<RankingFactorKind, 'improvement'>, string>;

const BASIS_EXPLANATIONS = {
  medianOfThree: 'insights.ranking.improvement.medianOfThree',
  firstToLast: 'insights.ranking.improvement.firstToLast',
} as const satisfies Record<ImprovementBasisKind, string>;

interface RankingFactorsGroupProps {
  ranking: SectionRankingScores;
}

/**
 * Why the engine put this card in front of the athlete: its four selection
 * factors, each with its scale or comparison basis. The composite the ranker
 * sorts on is not shown.
 */
export const RankingFactorsGroup = React.memo(function RankingFactorsGroup({
  ranking,
}: RankingFactorsGroupProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const primary = [styles.label, isDark && styles.labelDark];
  const secondary = [styles.note, isDark && styles.noteDark];

  const valueOf = (factor: RankingFactor): string =>
    factor.change ??
    (factor.score != null
      ? t('insights.ranking.scoreOnScale', { score: factor.score })
      : t('insights.ranking.unavailable'));

  const explanationOf = (factor: RankingFactor): string | null => {
    if (factor.kind !== 'improvement') return t(EXPLANATIONS[factor.kind]);
    return factor.basis ? t(BASIS_EXPLANATIONS[factor.basis]) : null;
  };

  return (
    <View testID="ranking-factors" style={styles.container}>
      <Text style={[styles.title, isDark && styles.titleDark]}>{t('insights.ranking.title')}</Text>
      <Text style={secondary}>{t('insights.ranking.intro')}</Text>
      {rankingFactors(ranking).map((factor) => {
        const explanation = explanationOf(factor);
        return (
          <View key={factor.kind} testID={`ranking-factor-${factor.kind}`} style={styles.row}>
            <View style={styles.line}>
              <Text style={primary}>{t(LABELS[factor.kind])}</Text>
              <Text testID={`ranking-factor-value-${factor.kind}`} style={primary}>
                {valueOf(factor)}
              </Text>
            </View>
            {explanation ? <Text style={secondary}>{explanation}</Text> : null}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  titleDark: {
    color: darkColors.textSecondary,
  },
  row: {
    gap: spacing.xxs,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textPrimary,
  },
  labelDark: {
    color: darkColors.textPrimary,
  },
  note: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  noteDark: {
    color: darkColors.textSecondary,
  },
});
