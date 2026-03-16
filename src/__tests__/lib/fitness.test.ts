import { calculateTSB, getFormZone, type FormZone } from '@/lib/algorithms/fitness';
import type { WellnessData } from '@/types';

describe('calculateTSB', () => {
  it('calculates TSB as CTL minus ATL', () => {
    const wellness: WellnessData[] = [
      { id: '1', ctl: 50, atl: 40 } as WellnessData,
      { id: '2', ctl: 60, atl: 80 } as WellnessData,
      { id: '3', ctl: 45, atl: 45 } as WellnessData,
    ];

    const result = calculateTSB(wellness);

    expect(result[0].tsb).toBe(10); // 50 - 40
    expect(result[1].tsb).toBe(-20); // 60 - 80
    expect(result[2].tsb).toBe(0); // 45 - 45
  });

  it('handles ctlLoad/atlLoad field variants', () => {
    const wellness: WellnessData[] = [{ id: '1', ctlLoad: 50, atlLoad: 30 } as WellnessData];

    const result = calculateTSB(wellness);

    expect(result[0].tsb).toBe(20); // 50 - 30
  });

  it('handles missing CTL/ATL values', () => {
    const wellness: WellnessData[] = [{ id: '1' } as WellnessData];

    const result = calculateTSB(wellness);

    expect(result[0].tsb).toBe(0); // 0 - 0
  });

  it('prefers ctl/atl over ctlLoad/atlLoad', () => {
    const wellness: WellnessData[] = [
      { id: '1', ctl: 100, atl: 50, ctlLoad: 10, atlLoad: 5 } as WellnessData,
    ];

    const result = calculateTSB(wellness);

    expect(result[0].tsb).toBe(50); // 100 - 50 (uses ctl/atl)
  });

  it('preserves original wellness data fields', () => {
    const wellness: WellnessData[] = [{ id: '1', ctl: 50, atl: 40, weight: 70 } as WellnessData];

    const result = calculateTSB(wellness);

    expect(result[0].id).toBe('1');
    expect(result[0].ctl).toBe(50);
    expect(result[0].atl).toBe(40);
    expect(result[0].weight).toBe(70);
    expect(result[0].tsb).toBe(10);
  });
});

describe('getFormZone', () => {
  const testCases: { tsb: number; expected: FormZone }[] = [
    // Deep Fatigue zone (TSB < -30)
    { tsb: -50, expected: 'deepFatigue' },
    { tsb: -40, expected: 'deepFatigue' },
    { tsb: -31, expected: 'deepFatigue' },

    // Productive zone (-30 <= TSB < -10)
    { tsb: -30, expected: 'productive' },
    { tsb: -20, expected: 'productive' },
    { tsb: -11, expected: 'productive' },

    // Maintenance zone (-10 <= TSB < 5)
    { tsb: -10, expected: 'maintenance' },
    { tsb: 0, expected: 'maintenance' },
    { tsb: 4, expected: 'maintenance' },

    // Fresh zone (5 <= TSB < 25)
    { tsb: 5, expected: 'fresh' },
    { tsb: 15, expected: 'fresh' },
    { tsb: 24, expected: 'fresh' },

    // Detraining zone (TSB >= 25)
    { tsb: 25, expected: 'detraining' },
    { tsb: 30, expected: 'detraining' },
    { tsb: 50, expected: 'detraining' },
  ];

  testCases.forEach(({ tsb, expected }) => {
    it(`returns "${expected}" for TSB = ${tsb}`, () => {
      expect(getFormZone(tsb)).toBe(expected);
    });
  });
});
