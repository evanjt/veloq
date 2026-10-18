/**
 * The key's rows for a line banded on the diverging ramp: a row for each of the
 * seven steps with the range it holds, a row for the dashed stretches with no
 * data where the line has them, and a note that the renderer softens each edge.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import type { MapPalette } from '@/theme';
import { DIVERGING_BANDS, type DivergingKind } from '../lib/divergingStep';
import { divergingBandLabel } from '../lib/divergingKeyLabels';
import { MapKeyNote, MapKeySwatch } from './MapKey';

export function DivergingKeyRows({
  kind,
  palette,
  isDark,
  showNoData = false,
  testID,
}: {
  kind: DivergingKind;
  /** The base map the line is drawn over, whose ramp the swatches repeat. */
  palette: MapPalette;
  isDark: boolean;
  /** The line has stretches with no data, drawn dashed in the base's muted colour. */
  showNoData?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {DIVERGING_BANDS[kind].map((band) => (
        <MapKeySwatch
          key={band.step}
          testID={testID ? `${testID}-${band.step}` : undefined}
          swatch={palette.div[band.step]}
          label={divergingBandLabel(t, band, kind)}
          isDark={isDark}
        />
      ))}
      {showNoData ? (
        <MapKeySwatch
          testID={testID ? `${testID}-no-data` : undefined}
          swatch={palette.muted}
          label={t('common.noData')}
          isDark={isDark}
        />
      ) : null}
      <MapKeyNote text={t('maps.bandEdgesSoft')} isDark={isDark} />
    </>
  );
}
