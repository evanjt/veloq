import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { tapTo } from '@/shared/app/navigation';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  spacing,
  typography,
  verdictFill,
  stroke,
} from '@/theme';
import type { StrengthBalancePair } from '@/types';

import {
  balanceStatusLabelKey,
  formatSetCount,
  formatBalanceRatio,
  type BalanceCopyKey,
} from '../lib/formatting';
import { Card, IconButton } from '@/shared/ui';
import { StrengthBalanceScale } from './StrengthBalanceScale';

interface StrengthBalanceViewProps {
  visibleBalancePairs: StrengthBalancePair[];
  featuredBalancePair: StrengthBalancePair | null;
  periodLabel: string;
}

/**
 * A split between two muscles has no better side, so the badges draw neutral
 * and name the band the ratio falls in rather than grading it.
 */
export const StrengthBalanceView = React.memo(function StrengthBalanceView({
  visibleBalancePairs,
  featuredBalancePair,
  periodLabel,
}: StrengthBalanceViewProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const balanceCopy = (key: BalanceCopyKey) => t(key);
  const openInfo = useCallback(() => tapTo('/sheets/strength-pairs-info'), []);

  if (visibleBalancePairs.length === 0) return null;

  return (
    <View style={styles.frame}>
      <Card variant="flat">
        <View style={styles.balanceHeader}>
          <View style={styles.balanceTitleColumn}>
            <View style={styles.balanceTitleRow}>
              <Text style={[styles.balanceTitle, isDark && styles.balanceTitleDark]}>
                {t('insights.strengthBalance.volumeSplit')}
              </Text>
              <IconButton accessibilityLabel={t('strength.pairsInfoTitle')} onPress={openInfo}>
                <MaterialCommunityIcons
                  name="information-outline"
                  size={iconSize.sm}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
              </IconButton>
            </View>
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
                { backgroundColor: verdictFill('neutral', isDark, true) },
              ]}
            >
              <Text style={[styles.balanceHeroBadgeText, isDark && styles.balanceBadgeTextDark]}>
                {formatBalanceRatio(featuredBalancePair, balanceCopy)}
              </Text>
            </View>
          ) : null}
        </View>

        {featuredBalancePair ? (
          <Text style={[styles.balanceHeroText, isDark && styles.balanceHeroTextDark]}>
            {featuredBalancePair.status === 'balanced'
              ? t('strength.balancedPairsClose')
              : t('strength.balanceDominant', {
                  dominant: featuredBalancePair.dominantLabel ?? t('strength.oneSide'),
                  other:
                    featuredBalancePair.dominantSlug === featuredBalancePair.leftSlug
                      ? featuredBalancePair.rightLabel
                      : featuredBalancePair.leftLabel,
                  pair: featuredBalancePair.label,
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
                  { backgroundColor: verdictFill('neutral', isDark) },
                ]}
              >
                <Text style={[styles.balanceStatusText, isDark && styles.balanceBadgeTextDark]}>
                  {t(balanceStatusLabelKey(pair.status))}
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

            <View style={styles.balanceScale}>
              <StrengthBalanceScale
                leftWeightedSets={pair.leftWeightedSets}
                rightWeightedSets={pair.rightWeightedSets}
              />
            </View>

            <Text style={[styles.balanceRatioText, isDark && styles.balanceRatioTextDark]}>
              {formatBalanceRatio(pair, balanceCopy)}
            </Text>
          </View>
        ))}

        <Text style={[styles.balanceFootnote, isDark && styles.balanceFootnoteDark]}>
          {t('strength.balanceFootnote')}
        </Text>
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    marginBottom: spacing.sm,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  balanceTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  balanceTitleDark: {
    color: darkColors.textPrimary,
  },
  balanceSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  balanceSubtitleDark: {
    color: darkColors.textSecondary,
  },
  balanceHeroBadge: {
    borderRadius: layout.borderRadiusMd,
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
  },
  balanceHeroBadgeText: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  balanceHeroText: {
    ...typography.bodyCompact,
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
    borderTopWidth: stroke.hairline,
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
    ...typography.bodySmallBold,
    flex: 1,
    color: colors.textPrimary,
  },
  balanceRowTitleDark: {
    color: darkColors.textPrimary,
  },
  balanceStatusBadge: {
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  balanceStatusText: {
    ...typography.badge,
    color: colors.textSecondary,
  },
  balanceBadgeTextDark: {
    color: darkColors.textSecondary,
  },
  balanceValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  balanceValueText: {
    ...typography.caption,
    flex: 1,
    color: colors.textSecondary,
  },
  balanceValueTextDark: {
    color: darkColors.textSecondary,
  },
  balanceScale: {
    marginTop: spacing.xs,
  },
  balanceRatioText: {
    ...typography.captionBold,
    color: colors.textPrimary,
    marginTop: spacing.xsPlus,
  },
  balanceRatioTextDark: {
    color: darkColors.textPrimary,
  },
  balanceFootnote: {
    fontSize: typography.label.fontSize,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  balanceFootnoteDark: {
    color: darkColors.textSecondary,
  },
  balanceTitleColumn: {
    flex: 1,
  },
  balanceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
});
