import {
  MapPreferencesSchema,
  GpsTrackSchema,
  GpsIndexSchema,
  ActivityMetricsSchema,
  SyncProgressSchema,
  CustomSectionSchema,
  CUSTOM_SECTION_MAX_SIZE_BYTES,
  validateCustomSection,
  safeParseWithSchema,
  parseWithSchemaStrict,
  createSchemaValidator,
} from '@/lib/validation/schemas';
import { z } from 'zod';

describe('MapPreferencesSchema', () => {
  it('accepts valid preferences with default style', () => {
    const result = MapPreferencesSchema.safeParse({
      defaultStyle: 'dark',
    });
    expect(result.success).toBe(true);
  });

  it('accepts without activityTypeStyles', () => {
    const result = MapPreferencesSchema.safeParse({ defaultStyle: 'light' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid style', () => {
    const result = MapPreferencesSchema.safeParse({ defaultStyle: 'neon' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid activity type in styles', () => {
    const result = MapPreferencesSchema.safeParse({
      defaultStyle: 'light',
      activityTypeStyles: { InvalidSport: 'dark' },
    });
    expect(result.success).toBe(false);
  });
});

describe('GpsTrackSchema', () => {
  it('accepts valid GPS track', () => {
    const result = GpsTrackSchema.safeParse([
      [45.0, 7.0],
      [45.1, 7.1],
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects single point (needs min 2)', () => {
    const result = GpsTrackSchema.safeParse([[45.0, 7.0]]);
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range latitude', () => {
    const result = GpsTrackSchema.safeParse([
      [91.0, 7.0],
      [45.0, 7.0],
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range longitude', () => {
    const result = GpsTrackSchema.safeParse([
      [45.0, 181.0],
      [45.0, 7.0],
    ]);
    expect(result.success).toBe(false);
  });
});

describe('GpsIndexSchema', () => {
  it('accepts valid index', () => {
    const result = GpsIndexSchema.safeParse({
      activityIds: ['a1', 'a2'],
      lastUpdated: '2024-06-15T12:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-datetime string', () => {
    const result = GpsIndexSchema.safeParse({
      activityIds: [],
      lastUpdated: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

describe('ActivityMetricsSchema', () => {
  const validMetrics = {
    activityId: 'act123',
    name: 'Morning Ride',
    date: 1700000000,
    distance: 42000,
    movingTime: 3600,
    elapsedTime: 4000,
    elevationGain: 500,
    sportType: 'Ride',
  };

  it('accepts valid metrics', () => {
    const result = ActivityMetricsSchema.safeParse(validMetrics);
    expect(result.success).toBe(true);
  });

  it('accepts optional HR and power', () => {
    const result = ActivityMetricsSchema.safeParse({
      ...validMetrics,
      avgHr: 145,
      avgPower: 250,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative distance', () => {
    const result = ActivityMetricsSchema.safeParse({ ...validMetrics, distance: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid sport type', () => {
    const result = ActivityMetricsSchema.safeParse({ ...validMetrics, sportType: 'Quidditch' });
    expect(result.success).toBe(false);
  });
});

describe('SyncProgressSchema', () => {
  it('accepts valid sync progress', () => {
    const result = SyncProgressSchema.safeParse({
      status: 'syncing',
      completed: 50,
      total: 100,
      message: 'Fetching activities...',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = SyncProgressSchema.safeParse({
      status: 'loading',
      completed: 0,
      total: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('CustomSectionSchema', () => {
  const validSection = {
    id: 'sec1',
    name: 'Hill Climb',
    polyline: [
      { latitude: 45.0, longitude: 7.0 },
      { latitude: 45.1, longitude: 7.1 },
    ],
    sourceActivityId: 'act1',
    startIndex: 0,
    endIndex: 100,
    sportType: 'Ride',
    distanceMeters: 5000,
  };

  it('accepts valid section', () => {
    const result = CustomSectionSchema.safeParse(validSection);
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CustomSectionSchema.safeParse({ ...validSection, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects polyline with fewer than 2 points', () => {
    const result = CustomSectionSchema.safeParse({
      ...validSection,
      polyline: [{ latitude: 45.0, longitude: 7.0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('validateCustomSection', () => {
  const validSection = {
    id: 'sec1',
    name: 'Hill Climb',
    polyline: [
      { latitude: 45.0, longitude: 7.0 },
      { latitude: 45.1, longitude: 7.1 },
    ],
    sourceActivityId: 'act1',
    startIndex: 0,
    endIndex: 100,
    sportType: 'Ride',
    distanceMeters: 5000,
  };

  it('validates object input', () => {
    const result = validateCustomSection(validSection);
    expect(result.id).toBe('sec1');
    expect(result.name).toBe('Hill Climb');
  });

  it('validates JSON string input', () => {
    const result = validateCustomSection(JSON.stringify(validSection));
    expect(result.id).toBe('sec1');
  });

  it('throws on invalid JSON string', () => {
    expect(() => validateCustomSection('not json')).toThrow('Invalid JSON string');
  });

  it('throws on schema validation failure', () => {
    expect(() => validateCustomSection({ id: '' })).toThrow('validation failed');
  });

  it('throws on oversized payload', () => {
    const hugePolyline = Array.from({ length: 50000 }, (_, i) => ({
      latitude: 45.0 + i * 0.0001,
      longitude: 7.0 + i * 0.0001,
      elevation: 100,
    }));
    const oversized = { ...validSection, polyline: hugePolyline };
    expect(() => validateCustomSection(oversized)).toThrow('Payload size exceeded');
  });
});

describe('safeParseWithSchema', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('returns data on valid input', () => {
    const result = safeParseWithSchema({ name: 'Alice', age: 30 }, schema, 'Test');
    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('returns null on invalid input', () => {
    const result = safeParseWithSchema({ name: 123 }, schema, 'Test');
    expect(result).toBeNull();
  });
});

describe('parseWithSchemaStrict', () => {
  const schema = z.object({ value: z.number().positive() });

  it('returns data on valid input', () => {
    const result = parseWithSchemaStrict({ value: 42 }, schema, 'Test');
    expect(result).toEqual({ value: 42 });
  });

  it('throws on invalid input with context', () => {
    expect(() => parseWithSchemaStrict({ value: -1 }, schema, 'TestCtx')).toThrow(
      'TestCtx validation failed'
    );
  });
});

describe('createSchemaValidator', () => {
  const schema = z.object({ x: z.number() });
  const validator = createSchemaValidator(schema);

  it('returns true for valid data', () => {
    expect(validator({ x: 5 })).toBe(true);
  });

  it('returns false for invalid data', () => {
    expect(validator({ x: 'not a number' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(validator(null)).toBe(false);
  });
});
