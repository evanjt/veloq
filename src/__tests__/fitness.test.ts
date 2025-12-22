import { calculateTSB, getFormZone, type FormZone } from '../lib/fitness';
import type { WellnessData } from '../types';

// Helper to create mock wellness data
function createWellnessDay(overrides: Partial<WellnessData>): WellnessData {
  return {
    id: '2024-06-15',
    ...overrides,
  };
}

describe('calculateTSB', () => {
  it('should calculate TSB as CTL - ATL', () => {
    const wellness = [
      createWellnessDay({ ctl: 50, atl: 40 }),
      createWellnessDay({ ctl: 60, atl: 80 }),
    ];

    const result = calculateTSB(wellness);

    expect(result[0].tsb).toBe(10); // 50 - 40
    expect(result[1].tsb).toBe(-20); // 60 - 80
  });

  it('should handle alternative field names (ctlLoad/atlLoad)', () => {
    // intervals.icu sometimes returns ctlLoad/atlLoad instead of ctl/atl
    const wellness = [
      createWellnessDay({ ctlLoad: 55, atlLoad: 45 }),
      createWellnessDay({ ctlLoad: 70, atlLoad: 90 }),
    ];

    const result = calculateTSB(wellness);

    expect(result[0].tsb).toBe(10); // 55 - 45
    expect(result[1].tsb).toBe(-20); // 70 - 90
  });

  it('should prefer ctl/atl over ctlLoad/atlLoad when both present', () => {
    const wellness = [
      createWellnessDay({ ctl: 50, atl: 40, ctlLoad: 100, atlLoad: 100 }),
    ];

    const result = calculateTSB(wellness);

    expect(result[0].tsb).toBe(10); // Uses ctl/atl: 50 - 40
  });

  it('should handle missing values as 0', () => {
    const wellness = [
      createWellnessDay({}), // No ctl or atl
      createWellnessDay({ ctl: 50 }), // Only ctl
      createWellnessDay({ atl: 30 }), // Only atl
    ];

    const result = calculateTSB(wellness);

    expect(result[0].tsb).toBe(0); // 0 - 0
    expect(result[1].tsb).toBe(50); // 50 - 0
    expect(result[2].tsb).toBe(-30); // 0 - 30
  });

  it('should preserve all original wellness data', () => {
    const wellness = [
      createWellnessDay({
        ctl: 50,
        atl: 40,
        weight: 75,
        restingHR: 55,
        hrv: 65,
      }),
    ];

    const result = calculateTSB(wellness);

    expect(result[0].weight).toBe(75);
    expect(result[0].restingHR).toBe(55);
    expect(result[0].hrv).toBe(65);
    expect(result[0].tsb).toBe(10);
  });
});

describe('getFormZone', () => {
  // Form zones based on TSB thresholds:
  // < -30: highRisk (overtrained, injury risk)
  // -30 to -10: optimal (productive training)
  // -10 to 5: grey (maintenance, unclear benefit)
  // 5 to 25: fresh (recovered, ready to perform)
  // > 25: transition (detraining, losing fitness)

  it('should classify deep negative TSB as highRisk', () => {
    expect(getFormZone(-31)).toBe('highRisk');
    expect(getFormZone(-50)).toBe('highRisk');
    expect(getFormZone(-100)).toBe('highRisk');
  });

  it('should classify moderate negative TSB as optimal', () => {
    expect(getFormZone(-30)).toBe('optimal');
    expect(getFormZone(-20)).toBe('optimal');
    expect(getFormZone(-11)).toBe('optimal');
  });

  it('should classify near-zero TSB as grey zone', () => {
    expect(getFormZone(-10)).toBe('grey');
    expect(getFormZone(0)).toBe('grey');
    expect(getFormZone(4)).toBe('grey');
  });

  it('should classify moderate positive TSB as fresh', () => {
    expect(getFormZone(5)).toBe('fresh');
    expect(getFormZone(15)).toBe('fresh');
    expect(getFormZone(24)).toBe('fresh');
  });

  it('should classify high positive TSB as transition', () => {
    expect(getFormZone(25)).toBe('transition');
    expect(getFormZone(40)).toBe('transition');
    expect(getFormZone(100)).toBe('transition');
  });

  it('should handle boundary values correctly', () => {
    // Exact boundaries
    expect(getFormZone(-30)).toBe('optimal'); // -30 is optimal, not highRisk
    expect(getFormZone(-10)).toBe('grey'); // -10 is grey, not optimal
    expect(getFormZone(5)).toBe('fresh'); // 5 is fresh, not grey
    expect(getFormZone(25)).toBe('transition'); // 25 is transition, not fresh
  });
});

describe('Form zone training implications', () => {
  // These tests document the training logic behind each zone

  const zones: { tsb: number; zone: FormZone; implication: string }[] = [
    { tsb: -40, zone: 'highRisk', implication: 'Rest required - injury/illness risk' },
    { tsb: -20, zone: 'optimal', implication: 'Productive training - fitness gains' },
    { tsb: 0, zone: 'grey', implication: 'Maintenance - neither gaining nor losing' },
    { tsb: 15, zone: 'fresh', implication: 'Recovered - good for racing/testing' },
    { tsb: 30, zone: 'transition', implication: 'Detraining - losing fitness' },
  ];

  zones.forEach(({ tsb, zone, implication }) => {
    it(`TSB ${tsb} should be ${zone}: ${implication}`, () => {
      expect(getFormZone(tsb)).toBe(zone);
    });
  });
});
