/**
 * Legend for the performance scatter chart: PR ring, reverse-direction
 * fill, this-activity ring, and the hollow mark for an attempt outside the
 * route's distance band. Shared by the route detail, section
 * detail, and activity Routes tab surfaces.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, spacing, typography, layout } from '@/theme';

export interface ScatterLegendProps {
  isDark: boolean;
  showReverse: boolean;
  showThisActivity: boolean;
  showOutsideBand?: boolean;
}

export function ScatterLegend({
  isDark,
  showReverse,
  showThisActivity,
  showOutsideBand = false,
}: ScatterLegendProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, styles.prSwatch, isDark && styles.prSwatchDark]} />
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
          <View
            style={[
              styles.legendSwatch,
              styles.thisActivitySwatch,
              isDark && styles.thisActivitySwatchDark,
            ]}
          />
          <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
            {t('sections.legendThisActivity')}
          </Text>
        </View>
      )}
      {showOutsideBand && (
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendSwatch,
              styles.outsideBandSwatch,
              isDark && styles.outsideBandSwatchDark,
            ]}
          />
          <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
            {t('sections.legendOutsideBand')}
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
    gap: spacing.xsPlus,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: layout.borderRadiusFull,
  },
  prSwatch: {
    borderColor: colors.chartGoldMark,
    borderWidth: 2,
  },
  prSwatchDark: {
    borderColor: darkColors.chartGoldMark,
  },
  reverseSwatch: {
    backgroundColor: colors.reverseDirection,
  },
  thisActivitySwatch: {
    borderColor: colors.chartGreenMark,
    borderWidth: 2,
  },
  thisActivitySwatchDark: {
    borderColor: darkColors.chartGreenMark,
  },
  outsideBandSwatch: {
    borderColor: colors.textSecondary,
    borderWidth: 1.5,
  },
  outsideBandSwatchDark: {
    borderColor: darkColors.textSecondary,
  },
  legendText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  legendTextDark: {
    color: darkColors.textSecondary,
  },
});
