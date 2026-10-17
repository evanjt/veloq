/**
 * Legend for the section and route detail maps: a row for each layer the map
 * draws over the subject's own line, the picked activity or lap, the ledger
 * version being shown and the delta colouring. The subject's line needs no row.
 */

import React from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { MapKey, MapKeySwatch } from '@/features/maps';
import { formatFullDate } from '@/shared/format/format';
import { colors, mapLayerColors } from '@/theme';

/** The attempt drawn over the subject's line, which the activity row names. */
export interface PickedAttempt {
  activityId?: string | null | undefined;
  /** When it was ridden, absent when the pick carried no date. */
  date?: Date | undefined;
  /** The activity the page was opened from, the one "This activity" means. */
  pageActivityId?: string | undefined;
}

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
  /** The attempt the activity row names; absent names it as the selected attempt. */
  pickedAttempt?: PickedAttempt | undefined;
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

/**
 * "This activity" means the activity the page was opened from and no other, so
 * any other attempt picked on the chart is named by its date.
 */
function pickedAttemptLabel(t: TFunction, pickedAttempt: PickedAttempt | undefined): string {
  const { activityId, date, pageActivityId } = pickedAttempt ?? {};
  if (activityId && activityId === pageActivityId) return t('sections.legendThisActivity');
  if (date) return formatFullDate(date);
  return t('sections.legendSelectedAttempt');
}

export function DetailMapLegend({
  isDark,
  top,
  testID,
  pickedAttempt,
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
          label={pickedAttemptLabel(t, pickedAttempt)}
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
