/**
 * FFI Validation Tests
 *
 * Tests the input validation, JSON parsing, and coordinate conversion
 * functions used at the FFI boundary. These are critical for preventing
 * crashes and data corruption.
 *
 * Note: We test the logic directly here since the native module requires
 * actual Rust bindings. The functions tested here mirror the implementations
 * in modules/veloqrs/src/index.ts
 */

// ============================================================================
// Pure function implementations for testing (mirror index.ts)
// ============================================================================

interface GpsPoint {
  latitude: number;
  longitude: number;
  elevation?: number;
}

interface RoutePoint {
  lat: number;
  lng: number;
}

/**
 * Convert flat coordinate array to GpsPoint array.
 * @param flatCoords - Flat array [lat1, lng1, lat2, lng2, ...]
 * @returns Array of GpsPoint objects
 */
function flatCoordsToPoints(flatCoords: number[]): GpsPoint[] {
  const points: GpsPoint[] = [];
  for (let i = 0; i < flatCoords.length - 1; i += 2) {
    points.push({
      latitude: flatCoords[i],
      longitude: flatCoords[i + 1],
      elevation: undefined,
    });
  }
  return points;
}

/**
 * Convert GpsPoint array to RoutePoint array (lat/lng format).
 */
function gpsPointsToRoutePoints(points: GpsPoint[]): RoutePoint[] {
  return points.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
}

/**
 * Convert RoutePoint array to GpsPoint array (latitude/longitude format).
 */
function routePointsToGpsPoints(points: RoutePoint[]): GpsPoint[] {
  return points.map((p) => ({
    latitude: p.lat,
    longitude: p.lng,
    elevation: undefined,
  }));
}

/**
 * Maximum allowed length for user-provided names.
 */
const MAX_NAME_LENGTH = 255;

/**
 * Regular expression to detect control characters.
 */
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Validate a user-provided name string.
 */
function validateName(name: string, fieldName: string): void {
  if (typeof name !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`
    );
  }
  if (CONTROL_CHAR_REGEX.test(name)) {
    throw new Error(`Invalid ${fieldName}: contains disallowed control characters`);
  }
}

/**
 * Validate a user-provided ID string.
 */
function validateId(id: string, fieldName: string): void {
  if (typeof id !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (id.length === 0) {
    throw new Error(`Invalid ${fieldName}: cannot be empty`);
  }
  if (id.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`
    );
  }
  if (CONTROL_CHAR_REGEX.test(id)) {
    throw new Error(`Invalid ${fieldName}: contains disallowed control characters`);
  }
}

/**
 * Convert snake_case keys to camelCase.
 */
function snakeToCamel(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = snakeToCamel(value);
    }
    return result;
  }
  return obj;
}

/**
 * Check if an object has snake_case keys.
 */
function hasSnakeCaseKeys(obj: unknown): boolean {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.keys(obj).some((key) => key.includes('_'));
  }
  if (Array.isArray(obj) && obj.length > 0) {
    return hasSnakeCaseKeys(obj[0]);
  }
  return false;
}

/**
 * Safely parse JSON with error handling.
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (json === null || json === undefined || json === '') {
    return fallback;
  }
  try {
    const parsed = JSON.parse(json);
    if (hasSnakeCaseKeys(parsed)) {
      return snakeToCamel(parsed) as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('FFI Validation', () => {
  describe('Coordinate Conversion Functions', () => {
    describe('flatCoordsToPoints()', () => {
      it('converts flat coordinate array to GpsPoint array', () => {
        const flatCoords = [51.5, -0.1, 51.51, -0.11, 51.52, -0.12];

        const points = flatCoordsToPoints(flatCoords);

        expect(points).toHaveLength(3);
        expect(points[0]).toEqual({
          latitude: 51.5,
          longitude: -0.1,
          elevation: undefined,
        });
        expect(points[1]).toEqual({
          latitude: 51.51,
          longitude: -0.11,
          elevation: undefined,
        });
        expect(points[2]).toEqual({
          latitude: 51.52,
          longitude: -0.12,
          elevation: undefined,
        });
      });

      it('handles empty array', () => {
        const points = flatCoordsToPoints([]);
        expect(points).toHaveLength(0);
      });

      it('handles single coordinate pair', () => {
        const points = flatCoordsToPoints([40.7128, -74.006]);
        expect(points).toHaveLength(1);
        expect(points[0].latitude).toBe(40.7128);
        expect(points[0].longitude).toBe(-74.006);
      });

      it('handles odd-length array by ignoring trailing value', () => {
        // If array has odd length, the last value is orphaned
        const points = flatCoordsToPoints([51.5, -0.1, 51.51]);
        expect(points).toHaveLength(1);
        expect(points[0].latitude).toBe(51.5);
        expect(points[0].longitude).toBe(-0.1);
      });

      it('preserves coordinate precision', () => {
        const preciseCoords = [51.507351, -0.127758, 48.856614, 2.352222];
        const points = flatCoordsToPoints(preciseCoords);

        expect(points[0].latitude).toBe(51.507351);
        expect(points[0].longitude).toBe(-0.127758);
        expect(points[1].latitude).toBe(48.856614);
        expect(points[1].longitude).toBe(2.352222);
      });

      it('handles extreme coordinate values', () => {
        // North Pole and South Pole
        const extremeCoords = [90, 0, -90, 180];
        const points = flatCoordsToPoints(extremeCoords);

        expect(points[0].latitude).toBe(90);
        expect(points[0].longitude).toBe(0);
        expect(points[1].latitude).toBe(-90);
        expect(points[1].longitude).toBe(180);
      });

      it('handles negative zero', () => {
        const coords = [-0, 0];
        const points = flatCoordsToPoints(coords);
        expect(Object.is(points[0].latitude, -0)).toBe(true);
      });

      it('handles NaN values (does not validate)', () => {
        // Current behavior: NaN passes through without validation
        const coords = [NaN, -0.1, 51.5, NaN];
        const points = flatCoordsToPoints(coords);

        expect(Number.isNaN(points[0].latitude)).toBe(true);
        expect(Number.isNaN(points[1].longitude)).toBe(true);
      });

      it('handles Infinity values (does not validate)', () => {
        // Current behavior: Infinity passes through
        const coords = [Infinity, -Infinity];
        const points = flatCoordsToPoints(coords);

        expect(points[0].latitude).toBe(Infinity);
        expect(points[0].longitude).toBe(-Infinity);
      });
    });

    describe('gpsPointsToRoutePoints()', () => {
      it('converts GpsPoint array to RoutePoint array', () => {
        const gpsPoints: GpsPoint[] = [
          { latitude: 51.5, longitude: -0.1, elevation: 100 },
          { latitude: 51.51, longitude: -0.11, elevation: 110 },
        ];

        const routePoints = gpsPointsToRoutePoints(gpsPoints);

        expect(routePoints).toHaveLength(2);
        expect(routePoints[0]).toEqual({ lat: 51.5, lng: -0.1 });
        expect(routePoints[1]).toEqual({ lat: 51.51, lng: -0.11 });
      });

      it('discards elevation data', () => {
        const gpsPoints: GpsPoint[] = [{ latitude: 51.5, longitude: -0.1, elevation: 500 }];

        const routePoints = gpsPointsToRoutePoints(gpsPoints);

        expect(routePoints[0]).not.toHaveProperty('elevation');
        expect(routePoints[0]).toEqual({ lat: 51.5, lng: -0.1 });
      });

      it('handles empty array', () => {
        const routePoints = gpsPointsToRoutePoints([]);
        expect(routePoints).toHaveLength(0);
      });

      it('handles undefined elevation', () => {
        const gpsPoints: GpsPoint[] = [{ latitude: 51.5, longitude: -0.1, elevation: undefined }];

        const routePoints = gpsPointsToRoutePoints(gpsPoints);

        expect(routePoints[0]).toEqual({ lat: 51.5, lng: -0.1 });
      });
    });

    describe('routePointsToGpsPoints()', () => {
      it('converts RoutePoint array to GpsPoint array', () => {
        const routePoints: RoutePoint[] = [
          { lat: 51.5, lng: -0.1 },
          { lat: 51.51, lng: -0.11 },
        ];

        const gpsPoints = routePointsToGpsPoints(routePoints);

        expect(gpsPoints).toHaveLength(2);
        expect(gpsPoints[0]).toEqual({
          latitude: 51.5,
          longitude: -0.1,
          elevation: undefined,
        });
        expect(gpsPoints[1]).toEqual({
          latitude: 51.51,
          longitude: -0.11,
          elevation: undefined,
        });
      });

      it('handles empty array', () => {
        const gpsPoints = routePointsToGpsPoints([]);
        expect(gpsPoints).toHaveLength(0);
      });

      it('always sets elevation to undefined', () => {
        const routePoints: RoutePoint[] = [{ lat: 51.5, lng: -0.1 }];

        const gpsPoints = routePointsToGpsPoints(routePoints);

        expect(gpsPoints[0].elevation).toBeUndefined();
      });
    });

    describe('Round-trip conversion', () => {
      it('preserves coordinates through GpsPoint -> RoutePoint -> GpsPoint', () => {
        const original: GpsPoint[] = [
          { latitude: 51.507351, longitude: -0.127758, elevation: 100 },
          { latitude: 48.856614, longitude: 2.352222, elevation: 200 },
        ];

        const routePoints = gpsPointsToRoutePoints(original);
        const converted = routePointsToGpsPoints(routePoints);

        expect(converted[0].latitude).toBe(original[0].latitude);
        expect(converted[0].longitude).toBe(original[0].longitude);
        expect(converted[1].latitude).toBe(original[1].latitude);
        expect(converted[1].longitude).toBe(original[1].longitude);
        // Elevation is lost in conversion
        expect(converted[0].elevation).toBeUndefined();
      });

      it('preserves coordinates through flat -> GpsPoint -> RoutePoint', () => {
        const flatCoords = [51.507351, -0.127758, 48.856614, 2.352222];

        const gpsPoints = flatCoordsToPoints(flatCoords);
        const routePoints = gpsPointsToRoutePoints(gpsPoints);

        expect(routePoints[0].lat).toBe(51.507351);
        expect(routePoints[0].lng).toBe(-0.127758);
        expect(routePoints[1].lat).toBe(48.856614);
        expect(routePoints[1].lng).toBe(2.352222);
      });
    });
  });

  describe('Input Validation', () => {
    describe('validateName()', () => {
      it('validates name length', () => {
        const longName = 'a'.repeat(256);

        expect(() => validateName(longName, 'route name')).toThrow('exceeds maximum length');
      });

      it('validates name for control characters', () => {
        const nameWithNull = 'Test\x00Name';

        expect(() => validateName(nameWithNull, 'route name')).toThrow(
          'contains disallowed control characters'
        );
      });

      it('allows normal names', () => {
        expect(() => validateName('My Favorite Route', 'route name')).not.toThrow();
      });

      it('allows unicode characters', () => {
        expect(() => validateName('Montée du Col 🏔️', 'route name')).not.toThrow();
      });

      it('allows max length name (255 chars)', () => {
        const maxName = 'a'.repeat(255);
        expect(() => validateName(maxName, 'route name')).not.toThrow();
      });

      it('validates name for bell character', () => {
        const nameWithBell = 'Test\x07Section';

        expect(() => validateName(nameWithBell, 'section name')).toThrow(
          'contains disallowed control characters'
        );
      });
    });

    describe('validateId()', () => {
      it('validates empty ID strings', () => {
        expect(() => validateId('', 'route ID')).toThrow('cannot be empty');
      });

      it('validates ID length', () => {
        const longId = 'x'.repeat(256);

        expect(() => validateId(longId, 'route ID')).toThrow('exceeds maximum length');
      });

      it('validates ID for control characters', () => {
        const idWithEscape = 'route\x1Bid';

        expect(() => validateId(idWithEscape, 'route ID')).toThrow(
          'contains disallowed control characters'
        );
      });

      it('allows valid IDs', () => {
        expect(() => validateId('route-123', 'route ID')).not.toThrow();
        expect(() => validateId('section_456', 'section ID')).not.toThrow();
        expect(() => validateId('activity-2024-01-15', 'activity ID')).not.toThrow();
      });

      it('validates ID with null character', () => {
        expect(() => validateId('section\x00id', 'section ID')).toThrow(
          'contains disallowed control characters'
        );
      });

      it('validates ID with delete character', () => {
        expect(() => validateId('group\x7Fid', 'group ID')).toThrow(
          'contains disallowed control characters'
        );
      });
    });
  });

  describe('JSON Parsing', () => {
    describe('safeJsonParse()', () => {
      it('parses valid JSON', () => {
        const json = '{"name": "Test", "value": 123}';
        const result = safeJsonParse(json, {});
        expect(result).toEqual({ name: 'Test', value: 123 });
      });

      it('returns fallback for null input', () => {
        const result = safeJsonParse(null, { default: true });
        expect(result).toEqual({ default: true });
      });

      it('returns fallback for undefined input', () => {
        const result = safeJsonParse(undefined, []);
        expect(result).toEqual([]);
      });

      it('returns fallback for empty string', () => {
        const result = safeJsonParse('', 'fallback');
        expect(result).toBe('fallback');
      });

      it('returns fallback for invalid JSON', () => {
        const result = safeJsonParse('not valid json{', []);
        expect(result).toEqual([]);
      });

      it('transforms snake_case keys to camelCase', () => {
        const json = '{"sport_type": "Ride", "activity_id": "123"}';
        const result = safeJsonParse<{ sportType: string; activityId: string }>(json, {
          sportType: '',
          activityId: '',
        });
        expect(result.sportType).toBe('Ride');
        expect(result.activityId).toBe('123');
      });

      it('preserves camelCase keys', () => {
        const json = '{"sportType": "Run", "activityId": "456"}';
        const result = safeJsonParse<{ sportType: string; activityId: string }>(json, {
          sportType: '',
          activityId: '',
        });
        expect(result.sportType).toBe('Run');
        expect(result.activityId).toBe('456');
      });

      it('handles arrays', () => {
        const json = '[{"sport_type": "Ride"}, {"sport_type": "Run"}]';
        const result = safeJsonParse<Array<{ sportType: string }>>(json, []);
        expect(result).toHaveLength(2);
        expect(result[0].sportType).toBe('Ride');
        expect(result[1].sportType).toBe('Run');
      });

      it('handles nested objects', () => {
        const json = '{"section_data": {"sport_type": "Run", "distance_meters": 5000}}';
        const result = safeJsonParse<{
          sectionData: { sportType: string; distanceMeters: number };
        }>(json, { sectionData: { sportType: '', distanceMeters: 0 } });
        expect(result.sectionData.sportType).toBe('Run');
        expect(result.sectionData.distanceMeters).toBe(5000);
      });
    });
  });
});

describe('Control Character Detection', () => {
  // Test the regex pattern used for control character detection
  const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

  it('detects null character', () => {
    expect(CONTROL_CHAR_REGEX.test('test\x00string')).toBe(true);
  });

  it('detects bell character', () => {
    expect(CONTROL_CHAR_REGEX.test('test\x07string')).toBe(true);
  });

  it('detects backspace character', () => {
    expect(CONTROL_CHAR_REGEX.test('test\x08string')).toBe(true);
  });

  it('detects escape character', () => {
    expect(CONTROL_CHAR_REGEX.test('test\x1Bstring')).toBe(true);
  });

  it('detects delete character', () => {
    expect(CONTROL_CHAR_REGEX.test('test\x7Fstring')).toBe(true);
  });

  it('allows space character', () => {
    expect(CONTROL_CHAR_REGEX.test('test string')).toBe(false);
  });

  it('allows tab character', () => {
    expect(CONTROL_CHAR_REGEX.test('test\tstring')).toBe(false);
  });

  it('allows newline character', () => {
    expect(CONTROL_CHAR_REGEX.test('test\nstring')).toBe(false);
  });

  it('allows carriage return', () => {
    expect(CONTROL_CHAR_REGEX.test('test\rstring')).toBe(false);
  });

  it('allows normal ASCII text', () => {
    expect(CONTROL_CHAR_REGEX.test('Hello World 123 !@#$%')).toBe(false);
  });

  it('allows unicode text', () => {
    expect(CONTROL_CHAR_REGEX.test('Héllo Wörld 日本語 🚴‍♂️')).toBe(false);
  });

  it('allows empty string', () => {
    expect(CONTROL_CHAR_REGEX.test('')).toBe(false);
  });
});

describe('JSON Parsing Edge Cases', () => {
  // These tests document the expected behavior of safeJsonParse
  // which is used internally by RouteEngineClient

  describe('Snake case to camel case transformation', () => {
    it('transforms snake_case keys to camelCase', () => {
      // This tests the snakeToCamel function behavior
      const input = { sport_type: 'Ride', activity_id: '123' };

      // Simulate what safeJsonParse does
      const snakeToCamel = (obj: unknown): unknown => {
        if (Array.isArray(obj)) {
          return obj.map(snakeToCamel);
        }
        if (obj !== null && typeof obj === 'object') {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(obj)) {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            result[camelKey] = snakeToCamel(value);
          }
          return result;
        }
        return obj;
      };

      const transformed = snakeToCamel(input);

      expect(transformed).toEqual({ sportType: 'Ride', activityId: '123' });
    });

    it('transforms nested objects', () => {
      const snakeToCamel = (obj: unknown): unknown => {
        if (Array.isArray(obj)) {
          return obj.map(snakeToCamel);
        }
        if (obj !== null && typeof obj === 'object') {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(obj)) {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            result[camelKey] = snakeToCamel(value);
          }
          return result;
        }
        return obj;
      };

      const input = {
        section_data: {
          sport_type: 'Run',
          distance_meters: 5000,
        },
      };

      const transformed = snakeToCamel(input);

      expect(transformed).toEqual({
        sectionData: {
          sportType: 'Run',
          distanceMeters: 5000,
        },
      });
    });

    it('transforms arrays of objects', () => {
      const snakeToCamel = (obj: unknown): unknown => {
        if (Array.isArray(obj)) {
          return obj.map(snakeToCamel);
        }
        if (obj !== null && typeof obj === 'object') {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(obj)) {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            result[camelKey] = snakeToCamel(value);
          }
          return result;
        }
        return obj;
      };

      const input = [{ activity_id: '1' }, { activity_id: '2' }];

      const transformed = snakeToCamel(input);

      expect(transformed).toEqual([{ activityId: '1' }, { activityId: '2' }]);
    });

    it('preserves camelCase keys', () => {
      const snakeToCamel = (obj: unknown): unknown => {
        if (Array.isArray(obj)) {
          return obj.map(snakeToCamel);
        }
        if (obj !== null && typeof obj === 'object') {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(obj)) {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            result[camelKey] = snakeToCamel(value);
          }
          return result;
        }
        return obj;
      };

      const input = { sportType: 'Ride', activityId: '123' };

      const transformed = snakeToCamel(input);

      expect(transformed).toEqual({ sportType: 'Ride', activityId: '123' });
    });

    it('handles keys with multiple underscores', () => {
      const snakeToCamel = (obj: unknown): unknown => {
        if (Array.isArray(obj)) {
          return obj.map(snakeToCamel);
        }
        if (obj !== null && typeof obj === 'object') {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(obj)) {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            result[camelKey] = snakeToCamel(value);
          }
          return result;
        }
        return obj;
      };

      const input = { some_long_property_name: 'value' };

      const transformed = snakeToCamel(input);

      expect(transformed).toEqual({ someLongPropertyName: 'value' });
    });

    it('preserves primitive values', () => {
      const snakeToCamel = (obj: unknown): unknown => {
        if (Array.isArray(obj)) {
          return obj.map(snakeToCamel);
        }
        if (obj !== null && typeof obj === 'object') {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(obj)) {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            result[camelKey] = snakeToCamel(value);
          }
          return result;
        }
        return obj;
      };

      expect(snakeToCamel('string')).toBe('string');
      expect(snakeToCamel(123)).toBe(123);
      expect(snakeToCamel(true)).toBe(true);
      expect(snakeToCamel(null)).toBe(null);
    });
  });
});
