import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  spacing,
  opacity,
  layout,
  brand,
  verdictColor,
  verdictFill,
  typography,
} from '@/theme';
import type { VerdictRung } from '@/theme';
import type { StrengthBalancePair } from '@/types';

import { formatSetCount, formatBalanceRatio } from '../lib/formatting';
import { BALANCE_PAIRS } from '../lib/analysis';

interface StrengthBalanceViewProps {
  visibleBalancePairs: StrengthBalancePair[];
  featuredBalancePair: StrengthBalancePair | null;
  periodLabel: string;
}

/**
 * A balance status is a verdict, so it draws from the one ladder rather than
 * a palette of its own. `watch` is the caution rung, a warning about what
 * comes next; `imbalanced` is a judgement already made, so it is negative.
 */
function balanceRung(status: string): VerdictRung {
  if (status === 'balanced') return 'positive';
  if (status === 'watch') return 'caution';
  return 'negative';
}

export const StrengthBalanceView = React.memo(function StrengthBalanceView({
  visibleBalancePairs,
  featuredBalancePair,
  periodLabel,
}: StrengthBalanceViewProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [infoOpen, setInfoOpen] = useState(false);
  const openInfo = useCallback(() => setInfoOpen(true), []);
  const closeInfo = useCallback(() => setInfoOpen(false), []);

  if (visibleBalancePairs.length === 0) return null;

  return (
    <View style={[styles.balanceCard, isDark && styles.balanceCardDark]}>
      <View style={styles.balanceHeader}>
        <View style={styles.balanceTitleColumn}>
          <View style={styles.balanceTitleRow}>
            <Text style={[styles.balanceTitle, isDark && styles.balanceTitleDark]}>
              {t('insights.strengthBalance.volumeSplit')}
            </Text>
            <TouchableOpacity
              onPress={openInfo}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('strength.pairsInfoTitle')}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons
                name="information-outline"
                size={16}
                color={isDark ? darkColors.textMuted : colors.textSecondary}
              />
            </TouchableOpacity>
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
              {
                backgroundColor: verdictFill(balanceRung(featuredBalancePair.status), isDark, true),
              },
            ]}
          >
            <Text
              style={[
                styles.balanceHeroBadgeText,
                { color: verdictColor(balanceRung(featuredBalancePair.status), isDark) },
              ]}
            >
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
                { backgroundColor: verdictFill(balanceRung(pair.status), isDark) },
              ]}
            >
              <Text
                style={[
                  styles.balanceStatusText,
                  { color: verdictColor(balanceRung(pair.status), isDark) },
                ]}
              >
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

      <Modal
        visible={infoOpen}
        transparent
        animationType="fade"
        onRequestClose={closeInfo}
        statusBarTranslucent
      >
        <Pressable style={styles.modalBackdrop} onPress={closeInfo}>
          <Pressable
            style={[styles.modalCard, isDark && styles.modalCardDark]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
              {t('strength.pairsInfoTitle')}
            </Text>
            <Text style={[styles.modalIntro, isDark && styles.modalIntroDark]}>
              {t('strength.pairsInfoIntro')}
            </Text>
            {BALANCE_PAIRS.map((pair) => (
              <Text key={pair.id} style={[styles.modalPair, isDark && styles.modalPairDark]}>
                • {pair.label}
              </Text>
            ))}
            <Text style={[styles.modalThresholds, isDark && styles.modalThresholdsDark]}>
              {t('strength.pairsInfoThresholds')}
            </Text>
            <Text style={[styles.modalThresholds, isDark && styles.modalThresholdsDark]}>
              {t('strength.pairsInfoMinSignal')}
            </Text>
            <TouchableOpacity onPress={closeInfo} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  balanceTitleDark: {
    color: darkColors.textPrimary,
  },
  balanceSubtitle: {
    fontSize: typography.caption.fontSize,
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
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  balanceHeroText: {
    fontSize: typography.bodyCompact.fontSize,
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
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
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
    fontSize: typography.label.fontSize,
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
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  balanceValueTextDark: {
    color: darkColors.textSecondary,
  },
  balanceScale: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 10,
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
    backgroundColor: opacity.overlay.light,
    marginTop: spacing.xs,
  },
  balanceScaleDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  balanceScaleSide: {
    height: '100%',
    backgroundColor: brand.tealLight,
  },
  balanceScaleSideSecondary: {
    height: '100%',
    backgroundColor: brand.tealDark,
  },
  balanceScaleGap: {
    width: 2,
    height: '100%',
    backgroundColor: colors.surface,
  },
  balanceRatioText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    gap: spacing.xs,
  },
  modalCardDark: {
    backgroundColor: darkColors.surface,
  },
  modalTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  modalTitleDark: {
    color: darkColors.textPrimary,
  },
  modalIntro: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  modalIntroDark: {
    color: darkColors.textSecondary,
  },
  modalPair: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textPrimary,
    paddingVertical: spacing.xxs,
  },
  modalPairDark: {
    color: darkColors.textPrimary,
  },
  modalThresholds: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 17,
  },
  modalThresholdsDark: {
    color: darkColors.textSecondary,
  },
  modalCloseButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-end',
    paddingVertical: spacing.xsPlus,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.subtle,
  },
  modalCloseText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
});
