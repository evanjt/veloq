import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { SheetHeader } from '@/shared/ui';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

import { listBalancePairNames } from '../lib/analysis';

interface StrengthPairsInfoSheetProps {
  isDark: boolean;
  onClose: () => void;
}

/** The pairs the balance view compares and the thresholds that flag one, shown in the pairs info sheet route. */
export function StrengthPairsInfoSheet({ isDark, onClose }: StrengthPairsInfoSheetProps) {
  const { t } = useTranslation();

  return (
    <View
      testID="strength-pairs-info-sheet"
      style={[styles.sheet, { backgroundColor: isDark ? darkColors.surface : colors.surface }]}
    >
      <SheetHeader title={t('strength.pairsInfoTitle')} onClose={onClose} />
      <View style={styles.body}>
        <Text style={[styles.intro, isDark && styles.introDark]}>
          {t('strength.pairsInfoIntro')}
        </Text>
        {listBalancePairNames(t).map(({ id, label }) => (
          <Text key={id} style={[styles.pair, isDark && styles.pairDark]}>
            • {label}
          </Text>
        ))}
        <Text style={[styles.thresholds, isDark && styles.thresholdsDark]}>
          {t('strength.pairsInfoThresholds')}
        </Text>
        <Text style={[styles.thresholds, isDark && styles.thresholdsDark]}>
          {t('strength.pairsInfoMinSignal')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingBottom: layout.screenPadding,
  },
  body: {
    paddingHorizontal: layout.screenPadding,
    gap: spacing.xs,
  },
  intro: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  introDark: {
    color: darkColors.textSecondary,
  },
  pair: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textPrimary,
    paddingVertical: spacing.xxs,
  },
  pairDark: {
    color: darkColors.textPrimary,
  },
  thresholds: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 17,
  },
  thresholdsDark: {
    color: darkColors.textSecondary,
  },
});
