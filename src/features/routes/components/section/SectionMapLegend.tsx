/**
 * Legend for the section detail map: a row for each layer the map draws over
 * the section's own line, the highlighted activity or lap, the ledger version
 * being shown and the delta colouring.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { MapKey, MapKeySwatch } from '@/features/maps';
import { colors, mapLayerColors } from '@/theme';

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
    <MapKey isDark={isDark} style={{ top }} testID="section-map-legend">
      {showDelta ? (
        <MapKeySwatch
          testID="section-map-legend-delta"
          swatch={[mapLayerColors.deltaWon, mapLayerColors.deltaNeutral, mapLayerColors.deltaLost]}
          label={t('sections.legendDeltaWonLost')}
          isDark={isDark}
        />
      ) : null}
      {showActivity ? (
        <MapKeySwatch
          swatch={colors.chartCyan}
          label={t('sections.legendThisActivity')}
          isDark={isDark}
        />
      ) : null}
      {showEarlierVersion ? (
        <MapKeySwatch
          swatch={colors.gray500}
          label={t('sections.legendEarlierVersion')}
          isDark={isDark}
        />
      ) : null}
    </MapKey>
  );
}
