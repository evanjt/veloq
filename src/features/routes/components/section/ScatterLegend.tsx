/**
 * Legend for the performance scatter chart: PR ring, reverse-direction
 * fill, this-activity ring, and the hollow mark for an attempt outside the
 * route's distance band. Shared by the route detail, section
 * detail, and activity Routes tab surfaces.
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, spacing, typography, layout, stroke, themePalette } from '@/theme';
import { Button } from '@/shared/ui';

export interface ScatterLegendProps {
  isDark: boolean;
  showReverse: boolean;
  showThisActivity: boolean;
  showOutsideBand?: boolean;
  showTrend?: boolean;
  trendColor?: string;
}

export function ScatterLegend({
  isDark,
  showReverse,
  showThisActivity,
  showOutsideBand = false,
  showTrend = false,
  trendColor: trendColorProp,
}: ScatterLegendProps) {
  const trendColor = trendColorProp ?? themePalette(isDark).actionPrimary;
  const { t } = useTranslation();
  const [showMethod, setShowMethod] = useState(false);

  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, styles.prSwatch, isDark && styles.prSwatchDark]} />
        <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
          {t('sections.legendPr')}
        </Text>
      </View>
      {showReverse ? (
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.reverseSwatch]} />
          <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
            {t('sections.legendReverse')}
          </Text>
        </View>
      ) : null}
      {showThisActivity ? (
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
      ) : null}
      {showOutsideBand ? (
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
      ) : null}
      {showTrend ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            style={styles.methodButton}
            label={t('sections.legendTrend')}
            // The legend key takes the trend line's own colour, which is what it names.
            icon={{ name: 'minus', ink: trendColor }}
            onPress={() => setShowMethod((shown) => !shown)}
          />
          <View style={styles.legendItem}>
            <View style={[styles.bandSwatch, { backgroundColor: trendColor }]} />
            <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
              {t('sections.legendTrendBand')}
            </Text>
          </View>
          {showMethod ? (
            <Text style={[styles.methodText, isDark && styles.legendTextDark]}>
              {t('sections.legendTrendMethod')}
            </Text>
          ) : null}
        </>
      ) : null}
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
    borderColor: colors.achievement,
    borderWidth: stroke.two,
  },
  prSwatchDark: {
    borderColor: darkColors.achievement,
  },
  reverseSwatch: {
    backgroundColor: colors.reverseDirection,
  },
  thisActivitySwatch: {
    borderColor: colors.chartGreenMark,
    borderWidth: stroke.two,
  },
  thisActivitySwatchDark: {
    borderColor: darkColors.chartGreenMark,
  },
  outsideBandSwatch: {
    borderColor: colors.textSecondary,
    borderWidth: stroke.two,
  },
  outsideBandSwatchDark: {
    borderColor: darkColors.textSecondary,
  },
  methodButton: {
    alignSelf: 'center',
  },
  bandSwatch: {
    width: 12,
    height: 10,
    opacity: 0.2,
  },
  methodText: {
    width: '100%',
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  legendText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  legendTextDark: {
    color: darkColors.textSecondary,
  },
});
