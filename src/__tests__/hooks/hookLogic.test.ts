// Mock modules that pull in react-native through their import chains.
// These mocks must be declared before any imports that trigger the chains.
jest.mock('@/api', () => ({
  intervalsApi: {},
}));

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => null,
}));

jest.mock('@/features/fitness/stores/SportPreferenceStore', () => ({
  ...jest.requireActual('@/features/fitness/stores/SportPreferenceStore'),
  SPORT_API_TYPES: {
    Cycling: ['Ride', 'VirtualRide'],
    Running: ['Run', 'VirtualRun', 'TrailRun'],
    Swimming: ['Swim', 'OpenWaterSwim'],
  },
}));

import { calculateZonesFromStreams } from '@/features/fitness/hooks/useZoneDistribution';
import {
  getSettingsForSport,
  getZoneColor,
  POWER_ZONE_COLORS,
  HR_ZONE_COLORS,
  DEFAULT_HR_ZONES,
} from '@/shared/app/useSportSettings';
import { SPORT_API_TYPES, SPORT_COLORS } from '@/features/fitness/stores/SportPreferenceStore';
import type { PrimarySport } from '@/features/fitness/stores/SportPreferenceStore';
import {
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  FORM_ZONE_BOUNDARIES,
  type FormZone,
} from '@/features/fitness/lib/fitness';
import { getLatestFTP, getLatestEFTP } from '@/features/activity/hooks/useEFTPHistory';
import type { SportSettings, Activity } from '@/types';

// ---------------------------------------------------------------------------
// calculateZonesFromStreams
// ---------------------------------------------------------------------------

describe('calculateZonesFromStreams', () => {
  const threeZones = [
    { min: 0, max: 100 },
    { min: 100, max: 200 },
    { min: 200, max: 300 },
  ];
  const threeColors = ['#aaa', '#bbb', '#ccc'];
  const threeNames = ['Low', 'Medium', 'High'];

  it('returns empty array for empty stream', () => {
    const result = calculateZonesFromStreams([], threeZones, threeColors, threeNames);
    expect(result).toEqual([]);
  });

  it('assigns all values to a single zone when stream falls in one zone', () => {
    const stream = [50, 60, 70, 80];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, threeNames);

    expect(result[0].seconds).toBe(4);
    expect(result[0].percentage).toBe(100);
    expect(result[1].seconds).toBe(0);
    expect(result[2].seconds).toBe(0);
  });

  it('distributes values across multiple zones', () => {
    // 3 in zone 1 (0-100), 2 in zone 2 (100-200), 1 in zone 3 (200-300)
    const stream = [10, 50, 90, 150, 180, 250];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, threeNames);

    expect(result[0].seconds).toBe(3);
    expect(result[1].seconds).toBe(2);
    expect(result[2].seconds).toBe(1);
  });

  it('handles values at zone boundaries (min inclusive, max exclusive)', () => {
    // value = 100 should go to zone 2 (min=100, max=200), not zone 1 (min=0, max=100)
    const stream = [0, 100, 200];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, threeNames);

    expect(result[0].seconds).toBe(1); // 0 is in [0, 100)
    expect(result[1].seconds).toBe(1); // 100 is in [100, 200)
    expect(result[2].seconds).toBe(1); // 200 is in [200, 300)
  });

  it('percentages sum to approximately 100', () => {
    const stream = [10, 50, 90, 110, 150, 190, 210, 250, 290];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, threeNames);

    const totalPct = result.reduce((sum, z) => sum + z.percentage, 0);
    // Due to rounding, allow a small deviation
    expect(totalPct).toBeGreaterThanOrEqual(99);
    expect(totalPct).toBeLessThanOrEqual(101);
  });

  it('assigns 1-indexed zone numbers, names, and colors from the input arrays', () => {
    const result = calculateZonesFromStreams([50], threeZones, threeColors, threeNames);

    expect(result.map((z) => z.zone)).toEqual([1, 2, 3]);
    expect(result.map((z) => z.name)).toEqual(['Low', 'Medium', 'High']);
    expect(result.map((z) => z.color)).toEqual(['#aaa', '#bbb', '#ccc']);
  });

  it('falls back to generic name when zoneNames is shorter than zones', () => {
    const stream = [50];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, ['Low']);

    expect(result[0].name).toBe('Low');
    expect(result[1].name).toBe('Zone 2');
    expect(result[2].name).toBe('Zone 3');
  });

  it('falls back to last color when zoneColors is shorter than zones', () => {
    const stream = [50];
    const result = calculateZonesFromStreams(stream, threeZones, ['#aaa'], threeNames);

    expect(result[0].color).toBe('#aaa');
    expect(result[1].color).toBe('#aaa'); // last color
    expect(result[2].color).toBe('#aaa'); // last color
  });

  it('ignores values outside all zone ranges', () => {
    // 500 is outside all zones [0,100), [100,200), [200,300)
    const stream = [50, 500];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, threeNames);

    // Only 50 should be counted, 500 is outside all zones
    const totalCounted = result.reduce((sum, z) => sum + z.seconds, 0);
    expect(totalCounted).toBe(1);
    // Percentage still based on total stream length (2)
    expect(result[0].percentage).toBe(50); // 1/2 = 50%
  });
});

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
  it('returns the palette color at valid indices for power and HR', () => {
    for (const idx of [0, 3, 6]) {
      expect(getZoneColor(idx, 'power')).toBe(POWER_ZONE_COLORS[idx]);
    }
    for (const idx of [0, 2, 4]) {
      expect(getZoneColor(idx, 'hr')).toBe(HR_ZONE_COLORS[idx]);
    }
  });

  it('clamps out-of-bounds index to the last color for power and HR', () => {
    const lastPower = POWER_ZONE_COLORS[POWER_ZONE_COLORS.length - 1];
    const lastHR = HR_ZONE_COLORS[HR_ZONE_COLORS.length - 1];
    for (const idx of [10, 100]) {
      expect(getZoneColor(idx, 'power')).toBe(lastPower);
      expect(getZoneColor(idx, 'hr')).toBe(lastHR);
    }
  });

  it('returns correct palette for power vs HR at same index', () => {
    // Both palettes now use intervals.icu colors - same color at shared indices
    expect(getZoneColor(4, 'power')).toBe(POWER_ZONE_COLORS[4]);
    expect(getZoneColor(4, 'hr')).toBe(HR_ZONE_COLORS[4]);
  });

  it('defaults to power when type is omitted', () => {
    expect(getZoneColor(0)).toBe(POWER_ZONE_COLORS[0]);
    expect(getZoneColor(3)).toBe(POWER_ZONE_COLORS[3]);
  });
});

// ---------------------------------------------------------------------------
// Zone color and zone constant arrays
// ---------------------------------------------------------------------------

describe('HR_ZONE_COLORS', () => {
  it('has exactly 5 colors', () => {
    expect(HR_ZONE_COLORS).toHaveLength(5);
  });

  it('all entries are valid hex color strings', () => {
    HR_ZONE_COLORS.forEach((color) => {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });
});

describe('DEFAULT_HR_ZONES', () => {
  it('has exactly 5 zones', () => {
    expect(DEFAULT_HR_ZONES).toHaveLength(5);
  });

  it('has sequential IDs from 1 to 5', () => {
    DEFAULT_HR_ZONES.forEach((zone, idx) => {
      expect(zone.id).toBe(idx + 1);
    });
  });

  it('each zone has a non-empty name', () => {
    DEFAULT_HR_ZONES.forEach((zone) => {
      expect(zone.name).toBeTruthy();
      expect(zone.name.length).toBeGreaterThan(0);
    });
  });

  it('each zone has a color matching HR_ZONE_COLORS', () => {
    DEFAULT_HR_ZONES.forEach((zone, idx) => {
      expect(zone.color).toBe(HR_ZONE_COLORS[idx]);
    });
  });
});

// ---------------------------------------------------------------------------
// SPORT_API_TYPES and SPORT_COLORS
// ---------------------------------------------------------------------------

describe('SPORT_API_TYPES', () => {
  it('each primary sport includes its canonical API type', () => {
    const cases: { sport: PrimarySport; type: string }[] = [
      { sport: 'Cycling', type: 'Ride' },
      { sport: 'Running', type: 'Run' },
      { sport: 'Swimming', type: 'Swim' },
    ];
    for (const { sport, type } of cases) {
      expect(SPORT_API_TYPES[sport]).toContain(type);
    }
  });
});

describe('SPORT_COLORS', () => {
  const primarySports: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];

  it('each sport has a distinct color', () => {
    const colors = primarySports.map((s) => SPORT_COLORS[s]);
    const unique = new Set(colors);
    expect(unique.size).toBe(primarySports.length);
  });
});

// ---------------------------------------------------------------------------
// getFormZone and FORM_ZONE_COLORS / FORM_ZONE_LABELS / FORM_ZONE_BOUNDARIES
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

describe('FORM_ZONE constants', () => {
  const allZones: FormZone[] = ['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'];

  it('every zone has a valid color, label, and ordered boundaries', () => {
    for (const zone of allZones) {
      expect(FORM_ZONE_COLORS[zone]).toMatch(/^#[0-9A-Fa-f]{6}$/);

      expect(typeof FORM_ZONE_LABELS[zone]).toBe('string');
      expect(FORM_ZONE_LABELS[zone].length).toBeGreaterThan(0);

      const { min, max } = FORM_ZONE_BOUNDARIES[zone];
      expect(typeof min).toBe('number');
      expect(typeof max).toBe('number');
      expect(min).toBeLessThan(max);
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
