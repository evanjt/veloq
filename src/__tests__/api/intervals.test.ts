/**
 * Tests for the intervals.icu write surface.
 *
 * Every read moved into the Rust engine, so what is left to cover here is the
 * two writes: that they post where they say they do, and that demo mode
 * acknowledges locally instead of sending anything upstream.
 */

jest.mock('@/api/client', () => ({
  apiClient: {
    post: jest.fn(),
  },
  getAthleteId: jest.fn(() => 'i12345'),
}));

const authState = { isDemoMode: false, athleteId: 'i12345' };

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: jest.fn(() => authState) },
  DEMO_ATHLETE_ID: 'demo',
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

import { intervalsApi } from '@/api/intervals';
import { apiClient } from '@/api/client';

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

beforeEach(() => {
  mockPost.mockReset();
  authState.isDemoMode = false;
  authState.athleteId = 'i12345';
});

describe('intervalsApi.createManualActivity', () => {
  it('posts the activity to the athlete collection', async () => {
    mockPost.mockResolvedValue({ data: { id: 'new1' } });

    await intervalsApi.createManualActivity({
      name: 'Gym',
      type: 'WeightTraining',
      start_date_local: '2026-01-02T07:00:00',
      moving_time: 3600,
    } as never);

    expect(mockPost).toHaveBeenCalledWith(
      '/athlete/i12345/activities',
      expect.objectContaining({ name: 'Gym', type: 'WeightTraining' })
    );
  });

  it('defaults the trainer and commute flags rather than sending undefined', async () => {
    mockPost.mockResolvedValue({ data: { id: 'new1' } });

    await intervalsApi.createManualActivity({
      name: 'Gym',
      type: 'WeightTraining',
      start_date_local: '2026-01-02T07:00:00',
      moving_time: 3600,
    } as never);

    expect(mockPost.mock.calls[0][1]).toMatchObject({ trainer: false, commute: false });
  });

  it('acknowledges locally in demo mode without posting', async () => {
    authState.isDemoMode = true;

    const result = await intervalsApi.createManualActivity({
      name: 'Gym',
      type: 'WeightTraining',
      start_date_local: '2026-01-02T07:00:00',
      moving_time: 3600,
    } as never);

    expect(mockPost).not.toHaveBeenCalled();
    expect(result.id).toMatch(/^demo-/);
    expect(result.name).toBe('Gym');
  });
});

describe('intervalsApi.uploadActivity', () => {
  it('posts multipart form data with the device name', async () => {
    mockPost.mockResolvedValue({ data: { id: 'up1' } });

    await intervalsApi.uploadActivity(new ArrayBuffer(4), 'ride.fit', { name: 'Ride' });

    const [url, , config] = mockPost.mock.calls[0];
    expect(url).toBe('/athlete/i12345/activities');
    expect(config?.headers).toMatchObject({ 'Content-Type': 'multipart/form-data' });
  });

  it('propagates an upload rejection to the caller', async () => {
    mockPost.mockRejectedValueOnce(new Error('413 Payload Too Large'));

    await expect(intervalsApi.uploadActivity(new ArrayBuffer(4), 'ride.fit')).rejects.toThrow(
      '413 Payload Too Large'
    );
  });

  it('acknowledges locally in demo mode without posting', async () => {
    authState.isDemoMode = true;

    const result = await intervalsApi.uploadActivity(new ArrayBuffer(4), 'ride.fit');

    expect(mockPost).not.toHaveBeenCalled();
    expect(result.id).toMatch(/^demo-/);
  });
});
