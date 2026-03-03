/**
 * Tests for intervals.icu API methods.
 * Mocks apiClient to test request construction and response handling.
 */

jest.mock('@/api/client', () => ({
  apiClient: {
    get: jest.fn(),
  },
  getAthleteId: jest.fn(() => 'i12345'),
}));

jest.mock('@/providers/AuthStore', () => {
  const store = {
    getState: jest.fn(() => ({
      isDemoMode: false,
      athleteId: 'i12345',
    })),
  };
  return {
    useAuthStore: store,
    DEMO_ATHLETE_ID: 'demo',
  };
});

import { intervalsApi } from '@/api/intervals';
import { apiClient } from '@/api/client';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

beforeEach(() => {
  mockGet.mockReset();
});

describe('intervalsApi.getAthlete', () => {
  it('calls correct endpoint', async () => {
    mockGet.mockResolvedValue({ data: { id: 'i12345', name: 'Test' } });
    const result = await intervalsApi.getAthlete();
    expect(mockGet).toHaveBeenCalledWith('/athlete/i12345');
    expect(result.name).toBe('Test');
  });
});

describe('intervalsApi.getActivity', () => {
  it('calls correct endpoint with activity ID', async () => {
    mockGet.mockResolvedValue({ data: { id: 'act1', name: 'Morning Ride' } });
    const result = await intervalsApi.getActivity('act1');
    expect(mockGet).toHaveBeenCalledWith('/activity/act1');
    expect(result.name).toBe('Morning Ride');
  });
});

describe('intervalsApi.getActivities', () => {
  it('includes date range and fields params', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await intervalsApi.getActivities({ oldest: '2024-01-01', newest: '2024-06-01' });
    expect(mockGet).toHaveBeenCalledWith(
      '/athlete/i12345/activities',
      expect.objectContaining({
        params: expect.objectContaining({
          oldest: '2024-01-01',
          newest: '2024-06-01',
        }),
      })
    );
  });
});

describe('intervalsApi.getActivityStreams', () => {
  it('calls streams endpoint with .json suffix', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await intervalsApi.getActivityStreams('act1');
    expect(mockGet).toHaveBeenCalledWith('/activity/act1/streams.json', expect.anything());
  });
});

describe('intervalsApi.getWellness', () => {
  it('calls wellness endpoint with date params', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await intervalsApi.getWellness({ oldest: '2024-01-01', newest: '2024-03-01' });
    expect(mockGet).toHaveBeenCalledWith(
      '/athlete/i12345/wellness',
      expect.objectContaining({
        params: { oldest: '2024-01-01', newest: '2024-03-01' },
      })
    );
  });
});

describe('intervalsApi.getPowerCurve', () => {
  it('calls power-curves endpoint', async () => {
    mockGet.mockResolvedValue({ data: { list: [{ secs: [1, 5], values: [400, 350] }] } });
    const result = await intervalsApi.getPowerCurve({ sport: 'Ride', days: 365 });
    expect(mockGet).toHaveBeenCalledWith(
      '/athlete/i12345/power-curves.json',
      expect.objectContaining({
        params: { type: 'Ride', curves: '365d' },
      })
    );
    expect(result.secs).toEqual([1, 5]);
    expect(result.watts).toEqual([400, 350]);
  });
});

describe('intervalsApi.getPaceCurve', () => {
  it('computes pace from distance and time', async () => {
    mockGet.mockResolvedValue({
      data: {
        list: [
          {
            distance: [100, 200],
            values: [20, 50], // seconds
          },
        ],
      },
    });
    const result = await intervalsApi.getPaceCurve({ sport: 'Run' });
    // pace = distance / time → 100/20=5, 200/50=4
    expect(result.pace[0]).toBe(5);
    expect(result.pace[1]).toBe(4);
    expect(result.distances).toEqual([100, 200]);
    expect(result.times).toEqual([20, 50]);
  });
});

describe('intervalsApi.getSportSettings', () => {
  it('calls sport-settings endpoint', async () => {
    mockGet.mockResolvedValue({ data: [{ sport: 'Ride' }] });
    const result = await intervalsApi.getSportSettings();
    expect(mockGet).toHaveBeenCalledWith('/athlete/i12345/sport-settings');
    expect(result).toHaveLength(1);
  });
});

describe('intervalsApi.getActivityMap', () => {
  it('calls map endpoint', async () => {
    mockGet.mockResolvedValue({ data: { bounds: [1, 2, 3, 4], latlngs: [] } });
    await intervalsApi.getActivityMap('act1');
    expect(mockGet).toHaveBeenCalledWith('/activity/act1/map', expect.anything());
  });
});

describe('intervalsApi.getAthleteSummary', () => {
  it('calls athlete-summary with date range', async () => {
    mockGet.mockResolvedValue({ data: [{ week: '2024-W01' }] });
    const result = await intervalsApi.getAthleteSummary({
      start: '2024-01-01',
      end: '2024-01-07',
    });
    expect(mockGet).toHaveBeenCalledWith(
      '/athlete/i12345/athlete-summary',
      expect.objectContaining({
        params: { start: '2024-01-01', end: '2024-01-07' },
      })
    );
    expect(result).toHaveLength(1);
  });
});

describe('intervalsApi.getOldestActivityDate', () => {
  it('returns oldest date from activities', async () => {
    mockGet.mockResolvedValue({
      data: [
        { start_date_local: '2024-06-01' },
        { start_date_local: '2020-01-15' },
        { start_date_local: '2023-03-10' },
      ],
    });
    const result = await intervalsApi.getOldestActivityDate();
    expect(result).toBe('2020-01-15');
  });

  it('returns null for empty activities', async () => {
    mockGet.mockResolvedValue({ data: [] });
    const result = await intervalsApi.getOldestActivityDate();
    expect(result).toBeNull();
  });
});
