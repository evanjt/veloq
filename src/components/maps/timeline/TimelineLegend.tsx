import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

interface TimelineLegendProps {
  isDark?: boolean;
}

export function TimelineLegend({ isDark = false }: TimelineLegendProps) {
  const { t } = useTranslation();

  return (
    <View style={[styles.legend, isDark && styles.legendDark]}>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, styles.legendSelected]} />
        <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
          {t('maps.selected')}
        </Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, styles.legendCached]}>
          <View style={styles.legendStripe} />
        </View>
        <Text style={[styles.legendText, isDark && styles.legendTextDark]}>{t('maps.cached')}</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, styles.legendEmpty, isDark && styles.legendEmptyDark]} />
        <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
          {t('maps.notSynced')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendSwatch: {
    width: 16,
    height: 8,
    borderRadius: 2,
  },
  legendSelected: {
    backgroundColor: colors.primary,
  },
  legendCached: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  legendStripe: {
    width: 8,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  legendEmpty: {
    backgroundColor: colors.border,
  },
  legendText: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
  // Dark mode
  legendDark: {
    borderTopColor: darkColors.border,
  },
  legendTextDark: {
    color: darkColors.textMuted,
  },
  legendEmptyDark: {
    backgroundColor: darkColors.border,
  },
});
