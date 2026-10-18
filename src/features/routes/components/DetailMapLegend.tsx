/**
 * Legend for the section and route detail maps: a row for each layer the map
 * draws over the subject's own line, the picked activity or lap, the ledger
 * version being shown, the scale the line is banded on and the direction its
 * chevrons show. The subject's line needs no row.
 */

import React from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

import {
  DIRECTION_GLYPH,
  DivergingKeyScale,
  directionColours,
  MapKey,
  MapKeySwatch,
  type LineDirection,
} from '@/features/maps';
import { formatFullDate } from '@/shared/format/format';
import { colors, darkColors, typography, type MapPalette } from '@/theme';

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
  /** The subject's line is banded by how far ahead or behind the shown attempt is. */
  showDelta: boolean;
  /** The banded line has stretches the shown attempt has no data for. */
  showDeltaGaps?: boolean | undefined;
  /** The direction the chevrons along the subject's line show, absent when none are drawn. */
  direction?: LineDirection | null | undefined;
}

export interface DetailMapLegendProps extends DetailMapLegendLayers {
  isDark: boolean;
  /** The colours of the base map the key sits over, which its swatches repeat. */
  palette: MapPalette;
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
  direction = null,
}: DetailMapLegendLayers): boolean {
  return showActivity || showEarlierVersion || showDelta || direction !== null;
}

const DIRECTION_LABEL_KEYS = {
  forward: 'sections.forward',
  reverse: 'sections.reverse',
} as const;

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
  palette,
  top,
  testID,
  pickedAttempt,
  showActivity,
  showEarlierVersion = false,
  showDelta,
  showDeltaGaps = false,
  direction = null,
}: DetailMapLegendProps) {
  const { t } = useTranslation();
  const chevron = directionColours(palette);

  return (
    <MapKey isDark={isDark} style={{ top }} testID={testID}>
      {showDelta ? (
        <>
          <Text testID={`${testID}-delta`} style={[styles.caption, isDark && styles.captionDark]}>
            {t('maps.keyAheadOrBehindPercent')}
          </Text>
          <DivergingKeyScale
            kind="pace"
            palette={palette}
            isDark={isDark}
            showNoData={showDeltaGaps}
            testID={`${testID}-delta`}
          />
        </>
      ) : null}
      {direction ? (
        <MapKeySwatch
          testID={`${testID}-direction`}
          swatch={chevron.outline}
          glyph={{ name: DIRECTION_GLYPH, color: chevron.glyph }}
          label={t(DIRECTION_LABEL_KEYS[direction])}
          isDark={isDark}
        />
      ) : null}
      {showActivity ? (
        <MapKeySwatch
          swatch={palette.ink}
          label={pickedAttemptLabel(t, pickedAttempt)}
          isDark={isDark}
        />
      ) : null}
      {showEarlierVersion ? (
        <MapKeySwatch
          swatch={palette.muted}
          label={t('sections.legendEarlierVersion')}
          isDark={isDark}
        />
      ) : null}
    </MapKey>
  );
}

const styles = StyleSheet.create({
  caption: {
    ...typography.label,
    color: colors.textPrimary,
  },
  captionDark: {
    color: darkColors.textPrimary,
  },
});
