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

jest.mock('@/shared/app/AuthStore', () => {
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

describe('intervalsApi.getActivity', () => {
  it('calls correct endpoint with activity ID', async () => {
    mockGet.mockResolvedValue({ data: { id: 'act1', name: 'Morning Ride' } });
    const result = await intervalsApi.getActivity('act1');
    expect(mockGet).toHaveBeenCalledWith('/activity/act1');
    expect(result.name).toBe('Morning Ride');
  });
});

describe('intervalsApi.getActivityStreams', () => {
  it('calls streams endpoint with .json suffix', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await intervalsApi.getActivityStreams('act1');
    expect(mockGet).toHaveBeenCalledWith('/activity/act1/streams.json', expect.anything());
  });
});

describe('intervalsApi.getActivityMap', () => {
  it('calls map endpoint', async () => {
    mockGet.mockResolvedValue({ data: { bounds: [1, 2, 3, 4], latlngs: [] } });
    await intervalsApi.getActivityMap('act1');
    expect(mockGet).toHaveBeenCalledWith('/activity/act1/map', expect.anything());
  });
});

// ============================================================
// ERROR HANDLING EDGE CASES
// ============================================================

describe('error handling', () => {
  beforeEach(() => mockGet.mockReset());

  it('propagates request rejections from read methods', async () => {
    const calls: [() => Promise<unknown>, string][] = [
      [() => intervalsApi.getActivityStreams('nonexistent'), '404 Not Found'],
    ];
    for (const [call, message] of calls) {
      mockGet.mockReset();
      mockGet.mockRejectedValueOnce(new Error(message));
      await expect(call()).rejects.toThrow(message);
    }
  });

  it('handles malformed API response from getActivity', async () => {
    // Response with missing expected fields should still resolve (no client-side validation)
    mockGet.mockResolvedValueOnce({ data: { id: 'act1' } });
    const result = await intervalsApi.getActivity('act1');
    expect(result.id).toBe('act1');
    expect(result.name).toBeUndefined();
  });
});
