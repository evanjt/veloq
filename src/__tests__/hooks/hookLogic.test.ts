// Mock modules that pull in react-native through their import chains.
// These mocks must be declared before any imports that trigger the chains.
jest.mock('@/api', () => ({
  intervalsApi: {},
}));

jest.mock('@/lib/native/routeEngine', () => ({
  getRouteEngine: () => null,
}));

jest.mock('@/providers', () => ({
  SPORT_API_TYPES: {
    Cycling: ['Ride', 'VirtualRide'],
    Running: ['Run', 'VirtualRun', 'TrailRun'],
    Swimming: ['Swim', 'OpenWaterSwim'],
  },
}));

import { calculateZonesFromStreams } from '@/hooks/fitness/useZoneDistribution';
import {
  getSettingsForSport,
  getZoneColor,
  POWER_ZONE_COLORS,
  HR_ZONE_COLORS,
  DEFAULT_POWER_ZONES,
  DEFAULT_HR_ZONES,
} from '@/hooks/useSportSettings';
import { SPORT_API_TYPES, SPORT_COLORS } from '@/providers/SportPreferenceStore';
import type { PrimarySport } from '@/providers/SportPreferenceStore';
import {
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  FORM_ZONE_BOUNDARIES,
  type FormZone,
} from '@/lib/algorithms/fitness';
import { getLatestFTP, getLatestEFTP } from '@/hooks/activities/useEFTPHistory';
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

  it('assigns correct zone numbers (1-indexed)', () => {
    const stream = [50];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, threeNames);

    expect(result[0].zone).toBe(1);
    expect(result[1].zone).toBe(2);
    expect(result[2].zone).toBe(3);
  });

  it('assigns correct names from the zoneNames array', () => {
    const stream = [50];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, threeNames);

    expect(result[0].name).toBe('Low');
    expect(result[1].name).toBe('Medium');
    expect(result[2].name).toBe('High');
  });

  it('falls back to generic name when zoneNames is shorter than zones', () => {
    const stream = [50];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, ['Low']);

    expect(result[0].name).toBe('Low');
    expect(result[1].name).toBe('Zone 2');
    expect(result[2].name).toBe('Zone 3');
  });

  it('assigns correct colors from the zoneColors array', () => {
    const stream = [50];
    const result = calculateZonesFromStreams(stream, threeZones, threeColors, threeNames);

    expect(result[0].color).toBe('#aaa');
    expect(result[1].color).toBe('#bbb');
    expect(result[2].color).toBe('#ccc');
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

  it('returns undefined for undefined settings', () => {
    expect(getSettingsForSport(undefined, 'Ride')).toBeUndefined();
  });

  it('returns undefined for empty settings array', () => {
    expect(getSettingsForSport([], 'Ride')).toBeUndefined();
  });

  it('finds matching sport type', () => {
    const result = getSettingsForSport(mockSettings, 'Ride');
    expect(result).toBeDefined();
    expect(result?.ftp).toBe(250);
  });

  it('finds sport type within multi-type settings', () => {
    const result = getSettingsForSport(mockSettings, 'VirtualRide');
    expect(result).toBeDefined();
    expect(result?.ftp).toBe(250);
  });

  it('returns undefined for non-matching sport type', () => {
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
  it('returns correct power zone colors for valid indices', () => {
    expect(getZoneColor(0, 'power')).toBe(POWER_ZONE_COLORS[0]);
    expect(getZoneColor(3, 'power')).toBe(POWER_ZONE_COLORS[3]);
    expect(getZoneColor(6, 'power')).toBe(POWER_ZONE_COLORS[6]);
  });

  it('returns correct HR zone colors for valid indices', () => {
    expect(getZoneColor(0, 'hr')).toBe(HR_ZONE_COLORS[0]);
    expect(getZoneColor(2, 'hr')).toBe(HR_ZONE_COLORS[2]);
    expect(getZoneColor(4, 'hr')).toBe(HR_ZONE_COLORS[4]);
  });

  it('clamps out-of-bounds index to last color for power', () => {
    const lastPower = POWER_ZONE_COLORS[POWER_ZONE_COLORS.length - 1];
    expect(getZoneColor(10, 'power')).toBe(lastPower);
    expect(getZoneColor(100, 'power')).toBe(lastPower);
  });

  it('clamps out-of-bounds index to last color for HR', () => {
    const lastHR = HR_ZONE_COLORS[HR_ZONE_COLORS.length - 1];
    expect(getZoneColor(10, 'hr')).toBe(lastHR);
    expect(getZoneColor(100, 'hr')).toBe(lastHR);
  });

  it('returns different colors for power vs HR at same index', () => {
    // Index 4: power = Z5 VO2max (Orange), HR = Z5 Max (Red)
    expect(getZoneColor(4, 'power')).not.toBe(getZoneColor(4, 'hr'));
  });

  it('defaults to power when type is omitted', () => {
    expect(getZoneColor(0)).toBe(POWER_ZONE_COLORS[0]);
    expect(getZoneColor(3)).toBe(POWER_ZONE_COLORS[3]);
  });
});

// ---------------------------------------------------------------------------
// Zone color and zone constant arrays
// ---------------------------------------------------------------------------

describe('POWER_ZONE_COLORS', () => {
  it('has exactly 7 colors', () => {
    expect(POWER_ZONE_COLORS).toHaveLength(7);
  });

  it('all entries are valid hex color strings', () => {
    POWER_ZONE_COLORS.forEach((color) => {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });
});

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

describe('DEFAULT_POWER_ZONES', () => {
  it('has exactly 7 zones', () => {
    expect(DEFAULT_POWER_ZONES).toHaveLength(7);
  });

  it('has sequential IDs from 1 to 7', () => {
    DEFAULT_POWER_ZONES.forEach((zone, idx) => {
      expect(zone.id).toBe(idx + 1);
    });
  });

  it('each zone has a non-empty name', () => {
    DEFAULT_POWER_ZONES.forEach((zone) => {
      expect(zone.name).toBeTruthy();
      expect(zone.name.length).toBeGreaterThan(0);
    });
  });

  it('each zone has a color matching POWER_ZONE_COLORS', () => {
    DEFAULT_POWER_ZONES.forEach((zone, idx) => {
      expect(zone.color).toBe(POWER_ZONE_COLORS[idx]);
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
  const primarySports: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];

  it('has entries for all primary sports', () => {
    primarySports.forEach((sport) => {
      expect(SPORT_API_TYPES[sport]).toBeDefined();
    });
  });

  it('each sport has a non-empty array of API types', () => {
    primarySports.forEach((sport) => {
      expect(Array.isArray(SPORT_API_TYPES[sport])).toBe(true);
      expect(SPORT_API_TYPES[sport].length).toBeGreaterThan(0);
    });
  });

  it('all API type strings are non-empty', () => {
    primarySports.forEach((sport) => {
      SPORT_API_TYPES[sport].forEach((apiType) => {
        expect(typeof apiType).toBe('string');
        expect(apiType.length).toBeGreaterThan(0);
      });
    });
  });

  it('Cycling includes Ride', () => {
    expect(SPORT_API_TYPES.Cycling).toContain('Ride');
  });

  it('Running includes Run', () => {
    expect(SPORT_API_TYPES.Running).toContain('Run');
  });

  it('Swimming includes Swim', () => {
    expect(SPORT_API_TYPES.Swimming).toContain('Swim');
  });
});

describe('SPORT_COLORS', () => {
  const primarySports: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];

  it('has entries for all primary sports', () => {
    primarySports.forEach((sport) => {
      expect(SPORT_COLORS[sport]).toBeDefined();
    });
  });

  it('all colors are valid hex strings', () => {
    primarySports.forEach((sport) => {
      expect(SPORT_COLORS[sport]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

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

    // grey: -10 <= TSB < 5
    { tsb: -10, expected: 'grey' },
    { tsb: 0, expected: 'grey' },
    { tsb: 4, expected: 'grey' },

    // fresh: 5 <= TSB < 25
    { tsb: 5, expected: 'fresh' },
    { tsb: 15, expected: 'fresh' },
    { tsb: 24, expected: 'fresh' },

    // transition: TSB >= 25
    { tsb: 25, expected: 'transition' },
    { tsb: 50, expected: 'transition' },
    { tsb: 100, expected: 'transition' },
  ];

  boundaryTests.forEach(({ tsb, expected }) => {
    it(`returns "${expected}" for TSB = ${tsb}`, () => {
      expect(getFormZone(tsb)).toBe(expected);
    });
  });

  it('handles exact boundary at -30 (start of optimal)', () => {
    expect(getFormZone(-30)).toBe('optimal');
    expect(getFormZone(-30.01)).toBe('highRisk');
  });

  it('handles exact boundary at -10 (start of grey)', () => {
    expect(getFormZone(-10)).toBe('grey');
    expect(getFormZone(-10.01)).toBe('optimal');
  });

  it('handles exact boundary at 5 (start of fresh)', () => {
    expect(getFormZone(5)).toBe('fresh');
    expect(getFormZone(4.99)).toBe('grey');
  });

  it('handles exact boundary at 25 (start of transition)', () => {
    expect(getFormZone(25)).toBe('transition');
    expect(getFormZone(24.99)).toBe('fresh');
  });
});

describe('FORM_ZONE_COLORS', () => {
  const allZones: FormZone[] = ['highRisk', 'optimal', 'grey', 'fresh', 'transition'];

  it('has a color for every form zone', () => {
    allZones.forEach((zone) => {
      expect(FORM_ZONE_COLORS[zone]).toBeDefined();
    });
  });

  it('all colors are valid hex strings', () => {
    allZones.forEach((zone) => {
      expect(FORM_ZONE_COLORS[zone]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });
});

describe('FORM_ZONE_LABELS', () => {
  const allZones: FormZone[] = ['highRisk', 'optimal', 'grey', 'fresh', 'transition'];

  it('has a label for every form zone', () => {
    allZones.forEach((zone) => {
      expect(FORM_ZONE_LABELS[zone]).toBeDefined();
      expect(typeof FORM_ZONE_LABELS[zone]).toBe('string');
      expect(FORM_ZONE_LABELS[zone].length).toBeGreaterThan(0);
    });
  });
});

describe('FORM_ZONE_BOUNDARIES', () => {
  const allZones: FormZone[] = ['highRisk', 'optimal', 'grey', 'fresh', 'transition'];

  it('has boundaries for every form zone', () => {
    allZones.forEach((zone) => {
      expect(FORM_ZONE_BOUNDARIES[zone]).toBeDefined();
      expect(typeof FORM_ZONE_BOUNDARIES[zone].min).toBe('number');
      expect(typeof FORM_ZONE_BOUNDARIES[zone].max).toBe('number');
    });
  });

  it('each zone boundary has min < max', () => {
    allZones.forEach((zone) => {
      const { min, max } = FORM_ZONE_BOUNDARIES[zone];
      expect(min).toBeLessThan(max);
    });
  });

  it('zones are contiguous (no gaps between boundaries)', () => {
    // sorted by min ascending
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
  it('returns undefined for undefined activities', () => {
    expect(getLatestFTP(undefined)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(getLatestFTP([])).toBeUndefined();
  });

  it('returns undefined when no activities have FTP', () => {
    const activities = [
      { id: 'a1', start_date_local: '2025-01-10T10:00:00' } as Activity,
      { id: 'a2', start_date_local: '2025-01-11T10:00:00' } as Activity,
    ];
    expect(getLatestFTP(activities)).toBeUndefined();
  });

  it('returns the FTP from the most recent activity', () => {
    const activities = [
      { id: 'a1', start_date_local: '2025-01-10T10:00:00', icu_ftp: 200 } as Activity,
      { id: 'a2', start_date_local: '2025-01-15T10:00:00', icu_ftp: 250 } as Activity,
      { id: 'a3', start_date_local: '2025-01-12T10:00:00', icu_ftp: 220 } as Activity,
    ];
    expect(getLatestFTP(activities)).toBe(250);
  });

  it('skips activities with icu_ftp = 0', () => {
    const activities = [
      { id: 'a1', start_date_local: '2025-01-20T10:00:00', icu_ftp: 0 } as Activity,
      { id: 'a2', start_date_local: '2025-01-10T10:00:00', icu_ftp: 200 } as Activity,
    ];
    expect(getLatestFTP(activities)).toBe(200);
  });

  it('skips activities with undefined icu_ftp', () => {
    const activities = [
      { id: 'a1', start_date_local: '2025-01-20T10:00:00' } as Activity,
      { id: 'a2', start_date_local: '2025-01-15T10:00:00', icu_ftp: 230 } as Activity,
    ];
    expect(getLatestFTP(activities)).toBe(230);
  });

  it('returns single activity FTP when only one has a value', () => {
    const activities = [
      { id: 'a1', start_date_local: '2025-01-10T10:00:00', icu_ftp: 180 } as Activity,
    ];
    expect(getLatestFTP(activities)).toBe(180);
  });
});

describe('getLatestEFTP', () => {
  it('returns undefined for undefined activities', () => {
    expect(getLatestEFTP(undefined)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(getLatestEFTP([])).toBeUndefined();
  });

  it('returns undefined when no activities have eFTP', () => {
    const activities = [{ id: 'a1', start_date_local: '2025-01-10T10:00:00' } as Activity];
    expect(getLatestEFTP(activities)).toBeUndefined();
  });

  it('returns the eFTP from the most recent activity', () => {
    const activities = [
      { id: 'a1', start_date_local: '2025-01-10T10:00:00', icu_pm_ftp_watts: 240 } as Activity,
      { id: 'a2', start_date_local: '2025-01-15T10:00:00', icu_pm_ftp_watts: 260 } as Activity,
      { id: 'a3', start_date_local: '2025-01-12T10:00:00', icu_pm_ftp_watts: 250 } as Activity,
    ];
    expect(getLatestEFTP(activities)).toBe(260);
  });

  it('skips activities with icu_pm_ftp_watts = 0', () => {
    const activities = [
      { id: 'a1', start_date_local: '2025-01-20T10:00:00', icu_pm_ftp_watts: 0 } as Activity,
      { id: 'a2', start_date_local: '2025-01-10T10:00:00', icu_pm_ftp_watts: 245 } as Activity,
    ];
    expect(getLatestEFTP(activities)).toBe(245);
  });
});
