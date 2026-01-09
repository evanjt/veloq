/**
 * Tests for useGpsDataFetcher hook
 *
 * Tests GPS data fetching in demo and real API modes.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useGpsDataFetcher } from '@/hooks/routes/useGpsDataFetcher';
import * as FileSystem from 'expo-file-system/legacy';

// Mock expo-file-system
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/documents/',
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
}));

// Mock demo fixtures
jest.mock('@/data/demo/fixtures', () => ({
  getActivityMap: jest.fn(),
}));

// Mock intervals API
jest.mock('@/api/intervals', () => ({
  intervalsApi: {
    getAthleteSummary: jest.fn(),
  },
}));

// Mock native module
jest.mock('@/lib/native/routeEngine', () => ({
  routeEngine: {
    fetchActivityMapsWithProgress: jest.fn(),
  },
}));

// Mock credentials
jest.mock('@/providers', () => ({
  getStoredCredentials: jest.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('useGpsDataFetcher', () => {
  const mockActivities = [
    {
      id: 'activity1',
      name: 'Morning Ride',
      type: 'Ride',
      distance: 15000,
      start_date_local: '2024-01-15T10:00:00Z',
    },
    {
      id: 'activity2',
      name: 'Evening Run',
      type: 'Run',
      distance: 5000,
      start_date_local: '2024-01-15T18:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch demo GPS data', async () => {
    const { getActivityMap } = require('@/data/demo/fixtures');
    getActivityMap.mockResolvedValue({
      polyline: '_p~iF~ps|U', // Mock polyline
    });

    const { result } = renderHook(() => useGpsDataFetcher());

    let fetchResult: GpsFetchResult | null = null;

    await act(async () => {
      fetchResult = await result.current.fetchDemoGps(mockActivities, {
        nativeModule: {} as any,
        activityIds: ['activity1', 'activity2'],
        onProgress: jest.fn(),
      });
    });

    expect(fetchResult).not.toBeNull();
    expect(fetchResult?.successCount).toBe(2);
    expect(fetchResult?.errors).toHaveLength(0);
  });

  it('should fetch real API GPS data', async () => {
    const { getStoredCredentials } = require('@/providers');
    getStoredCredentials.mockResolvedValue({
      apiKey: 'test-key',
      athleteId: '12345',
    });

    const { routeEngine } = require('@/lib/native/routeEngine');
    routeEngine.fetchActivityMapsWithProgress.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      errors: [],
    });

    const { result } = renderHook(() => useGpsDataFetcher());

    let fetchResult: GpsFetchResult | null = null;

    await act(async () => {
      fetchResult = await result.current.fetchApiGps(mockActivities, {
        nativeModule: routeEngine,
        activityIds: ['activity1', 'activity2'],
        onProgress: jest.fn(),
      });
    });

    expect(fetchResult).not.toBeNull();
    expect(fetchResult?.successCount).toBe(2);
  });

  it('should handle empty activity list', async () => {
    const { getActivityMap } = require('@/data/demo/fixtures');
    getActivityMap.mockResolvedValue({
      polyline: '_p~iF~ps|U',
    });

    const { result } = renderHook(() => useGpsDataFetcher());

    let fetchResult: GpsFetchResult | null = null;

    await act(async () => {
      fetchResult = await result.current.fetchDemoGps([], {
        nativeModule: {} as any,
        activityIds: [],
        onProgress: jest.fn(),
      });
    });

    expect(fetchResult).not.toBeNull();
    expect(fetchResult?.successCount).toBe(0);
    expect(fetchResult?.errors).toHaveLength(0);
  });

  it('should track progress during fetch', async () => {
    const { getActivityMap } = require('@/data/demo/fixtures');
    getActivityMap.mockResolvedValue({
      polyline: '_p~iF~ps|U',
    });

    const { result } = renderHook(() => useGpsDataFetcher());

    const progressUpdates: number[] = [];
    const onProgress = jest.fn((progress: number) => {
      progressUpdates.push(progress);
    });

    await act(async () => {
      await result.current.fetchDemoGps(mockActivities, {
        nativeModule: {} as any,
        activityIds: ['activity1', 'activity2'],
        onProgress,
      });
    });

    // Should have called progress at least once
    expect(onProgress).toHaveBeenCalled();
    expect(progressUpdates.length).toBeGreaterThan(0);
  });

  it('should handle partial failures', async () => {
    const { getActivityMap } = require('@/data/demo/fixtures');
    getActivityMap
      .mockResolvedValueOnce({ polyline: '_p~iF~ps|U' })
      .mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useGpsDataFetcher());

    let fetchResult: GpsFetchResult | null = null;

    await act(async () => {
      fetchResult = await result.current.fetchDemoGps(mockActivities, {
        nativeModule: {} as any,
        activityIds: ['activity1', 'activity2'],
        onProgress: jest.fn(),
      });
    });

    expect(fetchResult).not.toBeNull();
    expect(fetchResult?.successCount).toBe(1);
    expect(fetchResult?.errors).toHaveLength(1);
  });

  it('should require credentials for API fetch', async () => {
    const { getStoredCredentials } = require('@/providers');
    getStoredCredentials.mockResolvedValue(null);

    const { result } = renderHook(() => useGpsDataFetcher());

    let fetchResult: GpsFetchResult | null = null;
    let caughtError: Error | null = null;

    await act(async () => {
      try {
        fetchResult = await result.current.fetchApiGps(mockActivities, {
          nativeModule: {} as any,
          activityIds: ['activity1'],
          onProgress: jest.fn(),
        });
      } catch (error) {
        caughtError = error as Error;
      }
    });

    expect(caughtError).not.toBeNull();
    expect(fetchResult).toBeNull();
  });
});

describe('Integration Tests', () => {
  it('should handle demo mode end-to-end', async () => {
    const { getActivityMap } = require('@/data/demo/fixtures');
    getActivityMap.mockImplementation((id: string) => {
      if (id === 'activity1') {
        return Promise.resolve({ polyline: 'polyline1' });
      }
      if (id === 'activity2') {
        return Promise.resolve({ polyline: 'polyline2' });
      }
      return Promise.reject(new Error('Not found'));
    });

    const { result } = renderHook(() => useGpsDataFetcher());

    const fetchResult = await act(async () => {
      return await result.current.fetchDemoGps(mockActivities, {
        nativeModule: {} as any,
        activityIds: ['activity1', 'activity2'],
        onProgress: jest.fn(),
      });
    });

    expect(fetchResult.successCount).toBe(2);
    expect(fetchResult.errors).toHaveLength(0);
  });

  it('should handle real API mode end-to-end', async () => {
    const { getStoredCredentials } = require('@/providers');
    getStoredCredentials.mockResolvedValue({
      apiKey: 'test-key',
      athleteId: '12345',
    });

    const { routeEngine } = require('@/lib/native/routeEngine');
    routeEngine.fetchActivityMapsWithProgress.mockImplementation(
      async (_apiKey: string, _ids: string[], _onProgress: (progress: number) => void) => {
        _onProgress(50);
        _onProgress(100);
        return {
          successCount: 2,
          failureCount: 0,
          errors: [],
        };
      }
    );

    const { result } = renderHook(() => useGpsDataFetcher());

    const onProgress = jest.fn();

    const fetchResult = await act(async () => {
      return await result.current.fetchApiGps(mockActivities, {
        nativeModule: routeEngine,
        activityIds: ['activity1', 'activity2'],
        onProgress,
      });
    });

    expect(fetchResult.successCount).toBe(2);
    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenCalledWith(100);
  });
});
