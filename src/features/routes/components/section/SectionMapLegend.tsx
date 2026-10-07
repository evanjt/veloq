/**
 * Legend for the section detail map: a row for each layer the map draws over
 * the section's own line, the highlighted activity or lap, the ledger version
 * being shown and the delta colouring.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, mapLayerColors, shadows, spacing, typography, layout } from '@/theme';

export interface SectionMapLegendProps {
  isDark: boolean;
  /** Where the map's top-left corner is free, below the inset and the hero header. */
  top: number;
  /** A chart-selected activity trace or lap is drawn over the section. */
  showActivity: boolean;
  /** A ledger version's line is drawn behind the section. */
  showEarlierVersion: boolean;
  /** The section line is coloured by the shown attempt's time won or lost. */
  showDelta: boolean;
}

/** Whether any layer beyond the section's own line is drawing, so the legend has something to name. */
export function hasLegendLayers({
  showActivity,
  showEarlierVersion,
  showDelta,
}: Pick<SectionMapLegendProps, 'showActivity' | 'showEarlierVersion' | 'showDelta'>): boolean {
  return showActivity || showEarlierVersion || showDelta;
}

export function SectionMapLegend({
  isDark,
  top,
  showActivity,
  showEarlierVersion,
  showDelta,
}: SectionMapLegendProps) {
  const { t } = useTranslation();

  return (
    <View
      style={[styles.legend, { top }, isDark && styles.legendDark]}
      testID="section-map-legend"
      pointerEvents="none"
    >
      {showDelta && (
        <View style={styles.item} testID="section-map-legend-delta">
          <View style={styles.deltaSwatch}>
            <View style={[styles.deltaHalf, { backgroundColor: mapLayerColors.deltaWon }]} />
            <View style={[styles.deltaHalf, { backgroundColor: mapLayerColors.deltaNeutral }]} />
            <View style={[styles.deltaHalf, { backgroundColor: mapLayerColors.deltaLost }]} />
          </View>
          <Text style={[styles.text, isDark && styles.textDark]}>
            {t('sections.legendDeltaWonLost')}
          </Text>
        </View>
      )}
      {showActivity && (
        <View style={styles.item}>
          <View style={[styles.lineSwatch, { backgroundColor: colors.chartCyan }]} />
          <Text style={[styles.text, isDark && styles.textDark]}>
            {t('sections.legendThisActivity')}
          </Text>
        </View>
      )}
      {showEarlierVersion && (
        <View style={styles.item}>
          <View style={[styles.lineSwatch, { backgroundColor: colors.gray500 }]} />
          <Text style={[styles.text, isDark && styles.textDark]}>
            {t('sections.legendEarlierVersion')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    // The caller gives `top`, because the map runs under the status bar.
    position: 'absolute',
    left: spacing.sm,
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
  deltaSwatch: {
    width: 28,
    height: 3,
    flexDirection: 'row',
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
  },
  deltaHalf: {
    flex: 1,
  },
  text: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
