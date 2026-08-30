// routeEngine pulls in react-native through its import chain, so the mock must be
// declared before any import that triggers it.
import {
  getSettingsForSport,
  getZoneColor,
  POWER_ZONE_COLORS,
  HR_ZONE_COLORS,
} from '@/shared/app/useSportSettings';
import { SPORT_COLORS } from '@/features/fitness/stores/SportPreferenceStore';
import type { PrimarySport } from '@/features/fitness/stores/SportPreferenceStore';
import { getFormZone, FORM_ZONE_BOUNDARIES, type FormZone } from '@/features/fitness/lib/fitness';
import { getLatestFTP, getLatestEFTP } from '@/features/activity/hooks/useEFTPHistory';
import type { SportSettings, Activity } from '@/types';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => null,
}));

// ---------------------------------------------------------------------------
// getSettingsForSport
// ---------------------------------------------------------------------------

describe('getSettingsForSport', () => {
  const mockSettings: SportSettings[] = [
    { types: ['Ride', 'VirtualRide'], ftp: 250 } as SportSettings,
    { types: ['Run', 'VirtualRun'], threshold_pace: 4.5 } as SportSettings,
    { types: ['Swim'], lthr: 160 } as SportSettings,
  ];

  it('returns undefined for undefined or empty settings', () => {
    expect(getSettingsForSport(undefined, 'Ride')).toBeUndefined();
    expect(getSettingsForSport([], 'Ride')).toBeUndefined();
  });

  it('finds the entry whose types include the sport, undefined when none match', () => {
    // Matches both single- and multi-type entries; non-member sport -> undefined.
    expect(getSettingsForSport(mockSettings, 'Ride')?.ftp).toBe(250);
    expect(getSettingsForSport(mockSettings, 'VirtualRide')?.ftp).toBe(250);
    expect(getSettingsForSport(mockSettings, 'Hike')).toBeUndefined();
  });

  it('returns the first matching entry when multiple could match', () => {
    const dupeSettings: SportSettings[] = [
      { types: ['Ride'], ftp: 200 } as SportSettings,
      { types: ['Ride'], ftp: 300 } as SportSettings,
    ];
    const result = getSettingsForSport(dupeSettings, 'Ride');
    expect(result?.ftp).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// getZoneColor
// ---------------------------------------------------------------------------

describe('getZoneColor', () => {
  it('clamps an index past the end of the palette to the last color', () => {
    const lastPower = POWER_ZONE_COLORS[POWER_ZONE_COLORS.length - 1];
    const lastHR = HR_ZONE_COLORS[HR_ZONE_COLORS.length - 1];
    // 5 and 6 are valid power indices but past the end of the shorter HR palette.
    for (const idx of [5, 6, 10, 100]) {
      expect(getZoneColor(idx, 'hr')).toBe(lastHR);
    }
    for (const idx of [7, 10, 100]) {
      expect(getZoneColor(idx, 'power')).toBe(lastPower);
    }
    expect(getZoneColor(6, 'power')).not.toBe(lastHR);
  });

  it('defaults to the power palette when type is omitted', () => {
    // Index 6 exists only in the power palette, so it separates the two defaults.
    expect(getZoneColor(6)).toBe(POWER_ZONE_COLORS[6]);
    expect(getZoneColor(6)).not.toBe(getZoneColor(6, 'hr'));
  });
});

// ---------------------------------------------------------------------------
// SPORT_COLORS
// ---------------------------------------------------------------------------

describe('SPORT_COLORS', () => {
  const primarySports: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];

  it('each sport has a distinct color', () => {
    const colors = primarySports.map((s) => SPORT_COLORS[s]);
    const unique = new Set(colors);
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

// ---------------------------------------------------------------------------
// getLatestFTP and getLatestEFTP
// ---------------------------------------------------------------------------

describe('getLatestFTP', () => {
  it('returns undefined when no activity supplies an FTP value', () => {
    // undefined input, empty array, and activities all lacking icu_ftp.
    const noFtp = [
      { id: 'a1', start_date_local: '2025-01-10T10:00:00' } as Activity,
      { id: 'a2', start_date_local: '2025-01-11T10:00:00' } as Activity,
    ];
    expect(getLatestFTP(undefined)).toBeUndefined();
    expect(getLatestFTP([])).toBeUndefined();
    expect(getLatestFTP(noFtp)).toBeUndefined();
  });

  it('returns the FTP from the most recent activity that has one', () => {
    // Picks latest by date; skips icu_ftp = 0 and undefined; handles a single entry.
    const cases: { activities: Activity[]; expected: number }[] = [
      {
        activities: [
          { id: 'a1', start_date_local: '2025-01-10T10:00:00', icu_ftp: 200 } as Activity,
          { id: 'a2', start_date_local: '2025-01-15T10:00:00', icu_ftp: 250 } as Activity,
          { id: 'a3', start_date_local: '2025-01-12T10:00:00', icu_ftp: 220 } as Activity,
        ],
        expected: 250,
      },
      {
        activities: [
          { id: 'a1', start_date_local: '2025-01-20T10:00:00', icu_ftp: 0 } as Activity,
          { id: 'a2', start_date_local: '2025-01-10T10:00:00', icu_ftp: 200 } as Activity,
        ],
        expected: 200,
      },
      {
        activities: [
          { id: 'a1', start_date_local: '2025-01-20T10:00:00' } as Activity,
          { id: 'a2', start_date_local: '2025-01-15T10:00:00', icu_ftp: 230 } as Activity,
        ],
        expected: 230,
      },
      {
        activities: [
          { id: 'a1', start_date_local: '2025-01-10T10:00:00', icu_ftp: 180 } as Activity,
        ],
        expected: 180,
      },
    ];

    for (const { activities, expected } of cases) {
      expect(getLatestFTP(activities)).toBe(expected);
    }
  });
});

describe('getLatestEFTP', () => {
  it('returns the eFTP from the most recent activity, skipping zero values', () => {
    const cases: { activities: Activity[]; expected: number }[] = [
      {
        activities: [
          { id: 'a1', start_date_local: '2025-01-10T10:00:00', icu_pm_ftp_watts: 240 } as Activity,
          { id: 'a2', start_date_local: '2025-01-15T10:00:00', icu_pm_ftp_watts: 260 } as Activity,
          { id: 'a3', start_date_local: '2025-01-12T10:00:00', icu_pm_ftp_watts: 250 } as Activity,
        ],
        expected: 260,
      },
      {
        activities: [
          { id: 'a1', start_date_local: '2025-01-20T10:00:00', icu_pm_ftp_watts: 0 } as Activity,
          { id: 'a2', start_date_local: '2025-01-10T10:00:00', icu_pm_ftp_watts: 245 } as Activity,
        ],
        expected: 245,
      },
    ];

    for (const { activities, expected } of cases) {
      expect(getLatestEFTP(activities)).toBe(expected);
    }
  });
});
