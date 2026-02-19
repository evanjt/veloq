/**
 * Tests for geocoding utilities.
 * Mocks fetch and AsyncStorage for deterministic behavior.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { reverseGeocode, generateRouteName, clearGeocodeCache } from '@/lib/geo/geocoding';

beforeEach(async () => {
  mockFetch.mockReset();
  await clearGeocodeCache();
});

describe('reverseGeocode', () => {
  it('returns location name from API response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        address: { road: 'Main Street', suburb: 'Downtown' },
      }),
    });
    const result = await reverseGeocode(48.8566, 2.3522);
    expect(result).toBe('Main Street, Downtown');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns named location when available', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'Central Park',
        address: { city: 'New York' },
      }),
    });
    const result = await reverseGeocode(40.7829, -73.9654);
    expect(result).toBe('Central Park');
  });

  it('falls back to city with qualifier', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        address: { city: 'Melbourne', state: 'Victoria' },
      }),
    });
    const result = await reverseGeocode(-37.8136, 144.9631);
    expect(result).toBe('Melbourne, Victoria');
  });

  it('returns null for missing address', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const result = await reverseGeocode(0, 0);
    expect(result).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await reverseGeocode(48.0, 2.0);
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));
    const result = await reverseGeocode(48.0, 2.0);
    expect(result).toBeNull();
  });

  it('uses memory cache for repeated calls', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        address: { village: 'Grindelwald' },
      }),
    });
    // First call hits API
    await reverseGeocode(46.6244, 8.0413);
    // Second call (same rounded coords) should use cache
    await reverseGeocode(46.6244, 8.0413);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns road without qualifier when no neighbourhood', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        address: { road: 'Highway 1' },
      }),
    });
    const result = await reverseGeocode(36.0, -121.0);
    expect(result).toBe('Highway 1');
  });
});

describe('generateRouteName', () => {
  it('generates loop name for loop routes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        address: { suburb: 'Richmond' },
      }),
    });
    const result = await generateRouteName(60.0, 25.0, 60.0, 25.0, true);
    expect(result).toBe('Richmond Loop');
  });

  it('generates point-to-point name', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({
          address: callCount === 1 ? { town: 'Start Town' } : { town: 'End Town' },
        }),
      };
    });
    // Unique coords far enough apart to get different cache keys
    const result = await generateRouteName(55.0, 12.0, 56.0, 13.0, false);
    expect(result).toBe('Start Town to End Town');
  });

  it('returns null when geocoding fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await generateRouteName(70.0, 20.0, 70.0, 20.0, true);
    expect(result).toBeNull();
  });

  it('uses just start name when end resolves same', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        address: { town: 'Same Town' },
      }),
    });
    // Close coords that round to same cache key → same name → no "to" format
    const result = await generateRouteName(65.0, 15.0, 65.001, 15.001, false);
    expect(result).toBe('Same Town');
  });
});
