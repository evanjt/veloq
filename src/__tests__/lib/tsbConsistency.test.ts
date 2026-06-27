/**
 * TSB has three computation sites that must agree on the formula TSB = CTL - ATL
 * for the same (ctl, atl): the pure `tsbFromLoads`, the chart-row `calculateTSB`,
 * and a plain `ctl - atl`. The one documented divergence is the null fallback:
 * `tsbFromLoads` returns null when a load is missing, while `calculateTSB` renders
 * 0 for that day so a chart never plots a distorted -atl.
 *
 * Imports use deep lib paths (not '@/features/fitness') so no feature barrel pulls
 * a native module into the pure-logic test.
 */

import { tsbFromLoads } from '@/shared/math/trainingLoad';
import { calculateTSB } from '@/features/fitness/lib/fitness';
import type { WellnessData } from '@/types';

function oneRow(ctl?: number, atl?: number): WellnessData[] {
  return [{ id: '2026-01-15', ctl, atl }];
}

describe('TSB 3-site consistency', () => {
  const pairs: [number, number][] = [
    [50, 50],
    [60, 40],
    [40, 60],
    [0, 0],
    [-10, 5],
    [100, 0],
  ];

  it.each(pairs)('agrees across all three sites for ctl=%p atl=%p', (ctl, atl) => {
    const plain = ctl - atl;
    const fromLoads = tsbFromLoads(ctl, atl);
    const fromCalc = calculateTSB(oneRow(ctl, atl))[0].tsb;

    expect(fromLoads).toBe(plain);
    expect(fromCalc).toBe(plain);
    expect(fromCalc).toBe(fromLoads);
  });

  it('reads the ctlLoad/atlLoad field variant identically', () => {
    const row: WellnessData[] = [{ id: '2026-01-15', ctlLoad: 70, atlLoad: 45 }];
    expect(calculateTSB(row)[0].tsb).toBe(tsbFromLoads(70, 45));
    expect(calculateTSB(row)[0].tsb).toBe(25);
  });

  describe('documented null-fallback divergence', () => {
    it('tsbFromLoads returns null when ctl is missing but calculateTSB renders 0', () => {
      expect(tsbFromLoads(undefined, 40)).toBeNull();
      expect(calculateTSB(oneRow(undefined, 40))[0].tsb).toBe(0);
    });

    it('holds symmetrically when atl is missing', () => {
      expect(tsbFromLoads(50, undefined)).toBeNull();
      expect(calculateTSB(oneRow(50, undefined))[0].tsb).toBe(0);
    });

    it('holds when both loads are missing', () => {
      expect(tsbFromLoads(undefined, undefined)).toBeNull();
      expect(calculateTSB(oneRow(undefined, undefined))[0].tsb).toBe(0);
    });
  });
});
