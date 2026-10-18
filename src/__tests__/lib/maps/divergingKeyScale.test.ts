/**
 * Scenario: the map key draws the seven-step diverging banding as one stepped
 * scale, with a tick at each edge between two bands.
 */

import { DIVERGING_BANDS, type DivergingKind } from '@/features/maps/lib/divergingStep';
import { divergingKeyScale } from '@/features/maps/lib/divergingKeyLabels';

const KINDS: DivergingKind[] = ['grade', 'pace'];

describe('divergingKeyScale', () => {
  it('ticks a grade at its six signed band edges', () => {
    const ticks = divergingKeyScale('grade');
    expect(ticks.map((tick) => tick.label)).toEqual(['-10', '-5', '-2', '+2', '+5', '+10']);
    expect(ticks.map((tick) => tick.at)).toEqual([1, 2, 3, 4, 5, 6].map((k) => k / 7));
  });

  it('ticks ahead or behind at its edges as sizes, since the ends name the side', () => {
    const ticks = divergingKeyScale('pace');
    expect(ticks.map((tick) => tick.label)).toEqual(['6', '3', '1', '1', '3', '6']);
    expect(ticks.map((tick) => tick.at)).toEqual([1, 2, 3, 4, 5, 6].map((k) => k / 7));
  });

  it.each(KINDS)('puts every %s tick on the edge two adjacent bands share', (kind) => {
    const bands = DIVERGING_BANDS[kind];
    const ticks = divergingKeyScale(kind);
    expect(ticks).toHaveLength(bands.length - 1);
    ticks.forEach((tick, i) => {
      const edge = bands[i]!.to;
      expect(bands[i + 1]!.from).toBe(edge);
      expect(Number.isFinite(edge)).toBe(true);
      expect(tick.edge).toBe(edge);
      expect(tick.at).toBeCloseTo((i + 1) / bands.length);
    });
  });
});
