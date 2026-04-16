import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { formatSetCount, formatBalanceRatio } from '@/lib/strength/formatting';
import { colors, darkColors, spacing, opacity, layout, brand } from '@/theme';
import type { StrengthBalancePair } from '@/types';

interface StrengthBalanceViewProps {
  visibleBalancePairs: StrengthBalancePair[];
  featuredBalancePair: StrengthBalancePair | null;
  periodLabel: string;
}

export const StrengthBalanceView = React.memo(function StrengthBalanceView({
  visibleBalancePairs,
  featuredBalancePair,
  periodLabel,
}: StrengthBalanceViewProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  if (visibleBalancePairs.length === 0) return null;

  return (
    <View style={[styles.balanceCard, isDark && styles.balanceCardDark]}>
      <View style={styles.balanceHeader}>
        <View>
          <Text style={[styles.balanceTitle, isDark && styles.balanceTitleDark]}>
            {t('insights.strengthBalance.volumeSplit')}
          </Text>
          <Text style={[styles.balanceSubtitle, isDark && styles.balanceSubtitleDark]}>
            {t('strength.balanceObservedPairs', {
              period: periodLabel,
            })}
          </Text>
        </View>
        {featuredBalancePair ? (
          <View
            style={[
              styles.balanceHeroBadge,
              featuredBalancePair.status === 'balanced'
                ? styles.balanceHeroBadgeBalanced
                : styles.balanceHeroBadgeAlert,
            ]}
          >
            <Text style={styles.balanceHeroBadgeText}>
              {formatBalanceRatio(featuredBalancePair)}
            </Text>
          </View>
        ) : null}
      </View>

      {featuredBalancePair ? (
        <Text style={[styles.balanceHeroText, isDark && styles.balanceHeroTextDark]}>
          {featuredBalancePair.status === 'balanced'
            ? t('strength.balancedPairsClose')
            : t('strength.balanceDominant', {
                dominant: featuredBalancePair.dominantLabel ?? 'One side',
                other:
                  featuredBalancePair.dominantSlug === featuredBalancePair.leftSlug
                    ? featuredBalancePair.rightLabel
                    : featuredBalancePair.leftLabel,
                pair: featuredBalancePair.label.toLowerCase(),
              })}
        </Text>
      ) : null}

      {visibleBalancePairs.map((pair, index) => (
        <View
          key={pair.id}
          style={[
            styles.balanceRow,
            index > 0 && styles.balanceRowBorder,
            index > 0 && isDark && styles.balanceRowBorderDark,
          ]}
        >
          <View style={styles.balanceRowHeader}>
            <Text style={[styles.balanceRowTitle, isDark && styles.balanceRowTitleDark]}>
              {pair.label}
            </Text>
            <View
              style={[
                styles.balanceStatusBadge,
                pair.status === 'balanced'
                  ? styles.balanceStatusBalanced
                  : pair.status === 'watch'
                    ? styles.balanceStatusWatch
                    : styles.balanceStatusImbalanced,
              ]}
            >
              <Text style={styles.balanceStatusText}>
                {pair.status === 'balanced'
                  ? t('insights.strengthBalance.balanced')
                  : pair.status === 'watch'
                    ? t('insights.strengthBalance.watch')
                    : pair.status === 'imbalanced'
                      ? t('insights.strengthBalance.imbalanced')
                      : pair.status === 'one-sided'
                        ? t('insights.strengthBalance.oneSided')
                        : t('insights.strengthBalance.lowSignal')}
              </Text>
            </View>
          </View>

          <View style={styles.balanceValueRow}>
            <Text style={[styles.balanceValueText, isDark && styles.balanceValueTextDark]}>
              {pair.leftLabel} {formatSetCount(pair.leftWeightedSets)}
            </Text>
            <Text style={[styles.balanceValueText, isDark && styles.balanceValueTextDark]}>
              {pair.rightLabel} {formatSetCount(pair.rightWeightedSets)}
            </Text>
          </View>

          <View style={[styles.balanceScale, isDark && styles.balanceScaleDark]}>
            <View
              style={[styles.balanceScaleSide, { flex: Math.max(pair.leftWeightedSets, 0.2) }]}
            />
            <View style={styles.balanceScaleGap} />
            <View
              style={[
                styles.balanceScaleSideSecondary,
                { flex: Math.max(pair.rightWeightedSets, 0.2) },
              ]}
            />
          </View>

          <Text style={[styles.balanceRatioText, isDark && styles.balanceRatioTextDark]}>
            {formatBalanceRatio(pair)}
          </Text>
        </View>
      ))}

      <Text style={[styles.balanceFootnote, isDark && styles.balanceFootnoteDark]}>
        {t('strength.balanceFootnote')}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  balanceCardDark: {
    backgroundColor: darkColors.surface,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  balanceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  balanceTitleDark: {
    color: darkColors.textPrimary,
  },
  balanceSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  balanceSubtitleDark: {
    color: darkColors.textSecondary,
  },
  balanceHeroBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  balanceHeroBadgeBalanced: {
    backgroundColor: '#22C55E18',
  },
  balanceHeroBadgeAlert: {
    backgroundColor: '#F9731618',
  },
  balanceHeroBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  balanceHeroText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  balanceHeroTextDark: {
    color: darkColors.textSecondary,
  },
  balanceRow: {
    paddingVertical: spacing.sm,
  },
  balanceRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  balanceRowBorderDark: {
    borderTopColor: darkColors.border,
  },
  balanceRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  balanceRowTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  balanceRowTitleDark: {
    color: darkColors.textPrimary,
  },
  balanceStatusBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  balanceStatusBalanced: {
    backgroundColor: '#22C55E18',
  },
  balanceStatusWatch: {
    backgroundColor: '#F59E0B18',
  },
  balanceStatusImbalanced: {
    backgroundColor: '#EF444418',
  },
  balanceStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  balanceValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  balanceValueText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  balanceValueTextDark: {
    color: darkColors.textSecondary,
  },
  balanceScale: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: opacity.overlay.light,
    marginTop: spacing.xs,
  },
  balanceScaleDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  balanceScaleSide: {
    height: '100%',
    backgroundColor: brand.orange,
  },
  balanceScaleSideSecondary: {
    height: '100%',
    backgroundColor: '#FB8C4E',
  },
  balanceScaleGap: {
    width: 2,
    height: '100%',
    backgroundColor: colors.surface,
  },
  balanceRatioText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 6,
  },
  balanceRatioTextDark: {
    color: darkColors.textPrimary,
  },
  balanceFootnote: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  balanceFootnoteDark: {
    color: darkColors.textSecondary,
  },
});
