// engine pulls in react-native through its import chain, so the mock must be
// declared before any import that triggers it.
import { PRIMARY_SPORT_FAMILY } from '@/features/fitness/stores/SportPreferenceStore';
import type { PrimarySport } from '@/features/fitness/stores/SportPreferenceStore';
import { formZoneBands, type FormZone } from '@/features/fitness/lib/fitness';

jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => true,
  getEngine: () => null,
}));

// ---------------------------------------------------------------------------
// PRIMARY_SPORT_FAMILY
// ---------------------------------------------------------------------------

describe('PRIMARY_SPORT_FAMILY', () => {
  const primarySports: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];

  vaultIt('each sport draws in a distinct family', () => {
    const families = primarySports.map((s) => PRIMARY_SPORT_FAMILY[s]);
    const unique = new Set(families);
    expect(unique.size).toBe(primarySports.length);
  });
});

describe('formZoneBands', () => {
  const allZones: FormZone[] = ['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'];

  it('are contiguous with no gap between zones', () => {
    const bands = formZoneBands([-30, -10, 5, 25]);
    const sorted = allZones.map((z) => ({ zone: z, ...bands[z]! })).sort((a, b) => a.min - b.min);

    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i].max).toBe(sorted[i + 1].min);
      expect(sorted[i].min).toBeLessThan(sorted[i].max);
    }
  });
});
