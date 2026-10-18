/**
 * The key's scale for a line banded on the diverging ramp: the seven steps as
 * one stepped bar, ticked at each edge between two bands with its two ends
 * named, and a row for the dashed stretches with no data where the line has
 * them. The heading above it carries the unit.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import type { MapPalette } from '@/theme';
import { DIVERGING_BANDS, type DivergingKind } from '../lib/divergingStep';
import { divergingKeyScale } from '../lib/divergingKeyLabels';
import { MapKeyRamp, MapKeySwatch } from './MapKey';

/** What each end of the scale stands for, cool end first. */
const END_KEYS = {
  grade: ['maps.keyDownhill', 'maps.keyUphill'],
  pace: ['maps.keyFaster', 'maps.keySlower'],
} as const;

export function DivergingKeyScale({
  kind,
  palette,
  isDark,
  showNoData = false,
  testID,
}: {
  kind: DivergingKind;
  /** The base map the line is drawn over, whose ramp the scale repeats. */
  palette: MapPalette;
  isDark: boolean;
  /** The line has stretches with no data, drawn dashed in the base's muted colour. */
  showNoData?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [cool, warm] = END_KEYS[kind];
  return (
    <>
      <MapKeyRamp
        testID={testID ? `${testID}-scale` : undefined}
        ramp={DIVERGING_BANDS[kind].map((band) => palette.div[band.step])}
        ticks={divergingKeyScale(kind)}
        ends={[t(cool), t(warm)]}
        isDark={isDark}
      />
      {showNoData ? (
        <MapKeySwatch
          testID={testID ? `${testID}-no-data` : undefined}
          swatch={palette.muted}
          label={t('common.noData')}
          isDark={isDark}
        />
      ) : null}
    </>
  );
}
