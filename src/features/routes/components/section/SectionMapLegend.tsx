/**
 * Legend for the section detail map: this section, and the other sections
 * near it. The nearby layer draws a dashed line and an endpoint dot at each
 * end, and named nothing, so beside the activity Sections tab, which answers
 * a different question, its dots read as the coverage of this activity (B600).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, mapLayerColors, shadows, spacing, typography, layout } from '@/theme';

export interface SectionMapLegendProps {
  isDark: boolean;
  /** The colour this section's own line is drawn in. */
  sectionColor: string;
}

export function SectionMapLegend({ isDark, sectionColor }: SectionMapLegendProps) {
  const { t } = useTranslation();

  return (
    <View
      style={[styles.legend, isDark && styles.legendDark]}
      testID="section-map-legend"
      pointerEvents="none"
    >
      <View style={styles.item}>
        <View style={[styles.lineSwatch, { backgroundColor: sectionColor }]} />
        <Text style={[styles.text, isDark && styles.textDark]}>
          {t('sections.legendThisSection')}
        </Text>
      </View>
      <View style={styles.item}>
        <View style={styles.nearbySwatch}>
          <View style={[styles.dot, { backgroundColor: mapLayerColors.nearbyStart }]} />
          <View style={styles.dashedLine} />
          <View style={[styles.dot, { backgroundColor: mapLayerColors.nearbyEnd }]} />
        </View>
        <Text style={[styles.text, isDark && styles.textDark]}>{t('sections.legendNearby')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    // Top left: the nearby popup takes the bottom of the map when one is tapped.
    position: 'absolute',
    left: spacing.sm,
    top: spacing.sm,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xsPlus,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  legendDark: {
    backgroundColor: darkColors.surface,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  lineSwatch: {
    width: 16,
    height: 3,
    borderRadius: layout.borderRadiusFull,
  },
  nearbySwatch: {
    width: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dashedLine: {
    flex: 1,
    height: 0,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutralLine,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: layout.borderRadiusFull,
  },
  text: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
