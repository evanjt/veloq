// engine pulls in react-native through its import chain, so the mock must be
// declared before any import that triggers it.
import { PRIMARY_SPORT_FAMILY } from '@/features/fitness/stores/SportPreferenceStore';
import type { PrimarySport } from '@/features/fitness/stores/SportPreferenceStore';
import { getFormZone, FORM_ZONE_BOUNDARIES, type FormZone } from '@/features/fitness/lib/fitness';

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
}));

// ---------------------------------------------------------------------------
// PRIMARY_SPORT_FAMILY
// ---------------------------------------------------------------------------

describe('PRIMARY_SPORT_FAMILY', () => {
  const primarySports: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];

  it('each sport draws in a distinct family', () => {
    const families = primarySports.map((s) => PRIMARY_SPORT_FAMILY[s]);
    const unique = new Set(families);
    expect(unique.size).toBe(primarySports.length);
  });
});

// ---------------------------------------------------------------------------
// getFormZone and FORM_ZONE_BOUNDARIES
// ---------------------------------------------------------------------------

describe('getFormZone', () => {
  const boundaryTests: { tsb: number; expected: FormZone }[] = [
    // highRisk: TSB < -30
    { tsb: -100, expected: 'highRisk' },
    { tsb: -31, expected: 'highRisk' },

    // optimal: -30 <= TSB < -10
    { tsb: -30, expected: 'optimal' },
    { tsb: -20, expected: 'optimal' },
    { tsb: -11, expected: 'optimal' },

    // greyZone: -10 <= TSB < 5
    { tsb: -10, expected: 'greyZone' },
    { tsb: 0, expected: 'greyZone' },
    { tsb: 4, expected: 'greyZone' },

    // fresh: 5 <= TSB < 25
    { tsb: 5, expected: 'fresh' },
    { tsb: 15, expected: 'fresh' },
    { tsb: 24, expected: 'fresh' },

    // transition: TSB >= 25
    { tsb: 25, expected: 'transition' },
    { tsb: 50, expected: 'transition' },
    { tsb: 100, expected: 'transition' },
  ];

  it('maps TSB to the correct form zone across the range', () => {
    for (const { tsb, expected } of boundaryTests) {
      expect(getFormZone(tsb)).toBe(expected);
    }
  });

  it('classifies values either side of each zone boundary', () => {
    // min inclusive, so the boundary value belongs to the higher zone; just below
    // it falls back to the lower zone.
    const edges: { boundary: number; atOrAbove: FormZone; below: number; belowZone: FormZone }[] = [
      { boundary: -30, atOrAbove: 'optimal', below: -30.01, belowZone: 'highRisk' },
      { boundary: -10, atOrAbove: 'greyZone', below: -10.01, belowZone: 'optimal' },
      { boundary: 5, atOrAbove: 'fresh', below: 4.99, belowZone: 'greyZone' },
      { boundary: 25, atOrAbove: 'transition', below: 24.99, belowZone: 'fresh' },
    ];

    for (const { boundary, atOrAbove, below, belowZone } of edges) {
      expect(getFormZone(boundary)).toBe(atOrAbove);
      expect(getFormZone(below)).toBe(belowZone);
    }
  });
});

describe('FORM_ZONE_BOUNDARIES', () => {
  const allZones: FormZone[] = ['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'];

  // The chart bands read the constant while the badge reads getFormZone, so the two
  // drifting apart would paint a band the classifier disagrees with.
  it('every band classifies back to its own zone under getFormZone', () => {
    for (const zone of allZones) {
      const { min, max } = FORM_ZONE_BOUNDARIES[zone];
      expect(min).toBeLessThan(max);
      expect(getFormZone(min)).toBe(zone);
      expect(getFormZone(max - 0.01)).toBe(zone);
    }
  });

  it('boundaries are contiguous (no gaps between zones)', () => {
    const sorted = allZones
      .map((z) => ({ zone: z, ...FORM_ZONE_BOUNDARIES[z] }))
      .sort((a, b) => a.min - b.min);

    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i].max).toBe(sorted[i + 1].min);
    }
  });
});
