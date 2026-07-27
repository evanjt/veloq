/**
 * Legend for the performance scatter chart: PR ring, reverse-direction
 * fill, and this-activity ring. Shared by the route detail, section
 * detail, and activity Routes tab surfaces.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { brand, colors, darkColors, spacing, typography } from '@/theme';

export interface ScatterLegendProps {
  isDark: boolean;
  showReverse: boolean;
  showThisActivity: boolean;
}

export function ScatterLegend({ isDark, showReverse, showThisActivity }: ScatterLegendProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, styles.prSwatch]} />
        <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
          {t('sections.legendPr')}
        </Text>
      </View>
      {showReverse && (
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.reverseSwatch]} />
          <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
            {t('sections.legendReverse')}
          </Text>
        </View>
      )}
      {showThisActivity && (
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.thisActivitySwatch]} />
          <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
            {t('sections.legendThisActivity')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  prSwatch: {
    borderColor: brand.gold,
    borderWidth: 2,
  },
  reverseSwatch: {
    backgroundColor: colors.reverseDirection,
  },
  thisActivitySwatch: {
    borderColor: colors.chartGreen,
    borderWidth: 2,
  },
  legendText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  legendTextDark: {
    color: darkColors.textSecondary,
  },
});
