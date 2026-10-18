/**
 * The ticks the map key sets along the diverging ramp: one at each edge two
 * adjacent bands share, read from `DIVERGING_BANDS`.
 */

import { formatDecimal, formatSigned } from '@/shared/format';
import { DIVERGING_BANDS, type DivergingKind } from './divergingStep';

/** One tick of the key's scale: the edge in percent, where it falls from 0 to 1, and its label. */
export interface DivergingKeyTick {
  edge: number;
  at: number;
  label: string;
}

/**
 * The six edges between the seven bands of `kind`, each at its share of the
 * evenly stepped scale. Grade is signed, since the sign is the slope's
 * direction. Ahead or behind is a bare size, since the scale's ends say
 * which side is faster.
 */
export function divergingKeyScale(kind: DivergingKind): DivergingKeyTick[] {
  const bands = DIVERGING_BANDS[kind];
  return bands.slice(0, -1).map((band, i) => ({
    edge: band.to,
    at: (i + 1) / bands.length,
    label: kind === 'grade' ? formatSigned(band.to, 0) : formatDecimal(Math.abs(band.to), 0),
  }));
}
