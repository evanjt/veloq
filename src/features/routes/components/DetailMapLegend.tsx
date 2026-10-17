/**
 * Legend for the section and route detail maps: a row for each layer the map
 * draws over the subject's own line, the picked activity or lap, the ledger
 * version being shown and the delta colouring. The subject's line needs no row.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { MapKey, MapKeySwatch } from '@/features/maps';
import { colors, mapLayerColors } from '@/theme';

export interface DetailMapLegendLayers {
  /** A picked activity trace or lap is drawn over the subject's line. */
  showActivity: boolean;
  /** A ledger version's line is drawn behind the subject's line. */
  showEarlierVersion?: boolean | undefined;
  /** The subject's line is coloured by the shown attempt's time won or lost. */
  showDelta: boolean;
}

export interface DetailMapLegendProps extends DetailMapLegendLayers {
  isDark: boolean;
  /** Where the map's top-left corner is free, below the inset and the hero header. */
  top: number;
  /** The key's own id; each row's id extends it. */
  testID: string;
}

/** Whether any layer beyond the subject's own line is drawing, so the legend has something to name. */
export function hasLegendLayers({
  showActivity,
  showEarlierVersion = false,
  showDelta,
}: DetailMapLegendLayers): boolean {
  return showActivity || showEarlierVersion || showDelta;
}

export function DetailMapLegend({
  isDark,
  top,
  testID,
  showActivity,
  showEarlierVersion = false,
  showDelta,
}: DetailMapLegendProps) {
  const { t } = useTranslation();

  return (
    <MapKey isDark={isDark} style={{ top }} testID={testID}>
      {showDelta ? (
        <MapKeySwatch
          testID={`${testID}-delta`}
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
