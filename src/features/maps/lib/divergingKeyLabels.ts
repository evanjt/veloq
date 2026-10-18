/**
 * What the map key says beside each step of the diverging ramp: the range of
 * grade or of time against the reference that the step holds.
 */

import type { TFunction } from 'i18next';

import {
  formatDecimal,
  formatPercent,
  formatSigned,
  formatSignedPercentage,
} from '@/shared/format';
import type { DivergingBand, DivergingKind } from './divergingStep';

/** The key's label for one band of `kind`, from `DIVERGING_BANDS`. */
export function divergingBandLabel(t: TFunction, band: DivergingBand, kind: DivergingKind): string {
  const { from, to } = band;
  if (from < 0 && to > 0) return t('maps.bandWithin', { value: formatPercent(to) });
  if (kind === 'grade') {
    if (from === -Infinity) return t('maps.bandBelow', { value: formatSignedPercentage(to) });
    if (to === Infinity) return t('maps.bandAbove', { value: formatSignedPercentage(from) });
    return t('maps.bandRange', { from: formatSigned(from, 0), to: formatSignedPercentage(to) });
  }
  // Faster is below zero, so a faster band runs from its larger size to its smaller.
  if (from === -Infinity) return t('maps.bandFasterThan', { value: formatPercent(-to) });
  if (to === Infinity) return t('maps.bandSlowerThan', { value: formatPercent(from) });
  return to <= 0
    ? t('maps.bandFaster', { from: formatDecimal(-to, 0), to: formatPercent(-from) })
    : t('maps.bandSlower', { from: formatDecimal(from, 0), to: formatPercent(to) });
}
