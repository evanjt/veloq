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

  it('rejects invalid style', () => {
    const result = MapPreferencesSchema.safeParse({ defaultStyle: 'neon' });
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

  it('rejects single point or out-of-range coordinates', () => {
    expect(GpsTrackSchema.safeParse([[45.0, 7.0]]).success).toBe(false);
    expect(
      GpsTrackSchema.safeParse([
        [91.0, 7.0],
        [45.0, 7.0],
      ]).success
    ).toBe(false);
  });
});

describe('GpsIndexSchema', () => {
  it('accepts valid index and rejects non-datetime lastUpdated', () => {
    expect(
      GpsIndexSchema.safeParse({ activityIds: ['a1'], lastUpdated: '2024-06-15T12:00:00Z' }).success
    ).toBe(true);
    expect(GpsIndexSchema.safeParse({ activityIds: [], lastUpdated: 'not-a-date' }).success).toBe(
      false
    );
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

  it('rejects negative distance or invalid sport type', () => {
    expect(ActivityMetricsSchema.safeParse({ ...validMetrics, distance: -1 }).success).toBe(false);
    expect(
      ActivityMetricsSchema.safeParse({ ...validMetrics, sportType: 'Quidditch' }).success
    ).toBe(false);
  });
});

describe('SyncProgressSchema', () => {
  it('accepts valid sync progress and rejects invalid status', () => {
    expect(
      SyncProgressSchema.safeParse({ status: 'syncing', completed: 50, total: 100 }).success
    ).toBe(true);
    expect(
      SyncProgressSchema.safeParse({ status: 'loading', completed: 0, total: 0 }).success
    ).toBe(false);
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

  it('accepts valid section and rejects empty name', () => {
    expect(CustomSectionSchema.safeParse(validSection).success).toBe(true);
    expect(CustomSectionSchema.safeParse({ ...validSection, name: '' }).success).toBe(false);
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

  it('validates object input and returns parsed section', () => {
    const result = validateCustomSection(validSection);
    expect(result.id).toBe('sec1');
    expect(result.name).toBe('Hill Climb');
  });

  it('throws on invalid JSON string, schema failure, or oversized payload', () => {
    expect(() => validateCustomSection('not json')).toThrow('Invalid JSON string');
    expect(() => validateCustomSection({ id: '' })).toThrow('validation failed');
    const hugePolyline = Array.from({ length: 50000 }, (_, i) => ({
      latitude: 45.0 + i * 0.0001,
      longitude: 7.0 + i * 0.0001,
      elevation: 100,
    }));
    expect(() => validateCustomSection({ ...validSection, polyline: hugePolyline })).toThrow(
      'Payload size exceeded'
    );
  });
});

describe('safeParseWithSchema', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('returns data on valid input, null on invalid', () => {
    expect(safeParseWithSchema({ name: 'Alice', age: 30 }, schema, 'Test')).toEqual({
      name: 'Alice',
      age: 30,
    });
    expect(safeParseWithSchema({ name: 123 }, schema, 'Test')).toBeNull();
  });
});

describe('parseWithSchemaStrict', () => {
  const schema = z.object({ value: z.number().positive() });

  it('returns data on valid input, throws with context on invalid', () => {
    expect(parseWithSchemaStrict({ value: 42 }, schema, 'Test')).toEqual({ value: 42 });
    expect(() => parseWithSchemaStrict({ value: -1 }, schema, 'TestCtx')).toThrow(
      'TestCtx validation failed'
    );
  });
});

describe('createSchemaValidator', () => {
  it('returns true for valid data, false for invalid or null', () => {
    const validator = createSchemaValidator(z.object({ x: z.number() }));
    expect(validator({ x: 5 })).toBe(true);
    expect(validator({ x: 'not a number' })).toBe(false);
    expect(validator(null)).toBe(false);
  });
});
