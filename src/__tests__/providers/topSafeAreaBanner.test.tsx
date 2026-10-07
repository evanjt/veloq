/**
 * Screens drop their own top edge whenever a banner owns the top inset. The
 * sync-error banner sits in that same slot, so it has to be part of the
 * provider's answer or the banner and the screen both pad the notch.
 */

import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { TopSafeAreaProvider, useTopSafeArea } from '@/shared/app/TopSafeAreaContext';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline, offlineBannerShown: !mockIsOnline }),
}));

let mockHealth: { lastError: string | null; lastSuccessAt: string | null } = {
  lastError: null,
  lastSuccessAt: null,
};
jest.mock('@/shared/native/useSyncHealth', () => ({
  useSyncHealth: () => mockHealth,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <TopSafeAreaProvider>{children}</TopSafeAreaProvider>;
}

describe('TopSafeAreaProvider with a failing sync', () => {
  beforeEach(() => {
    mockIsOnline = true;
    mockHealth = { lastError: null, lastSuccessAt: null };
    useAuthStore.setState({
      isAuthenticated: true,
      isDemoMode: false,
      hideDemoBanner: false,
    });
  });

  it('reserves the top edge for the sync-error banner', () => {
    mockHealth = { lastError: 'HTTP 503', lastSuccessAt: null };
    const { result } = renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.activeBanner).toBe('syncError');
    expect(result.current.hasTopBanner).toBe(true);
    expect(result.current.screenEdges).not.toContain('top');
  });

  it.each([false, true])('ignores demo sync errors with hideDemoBanner=%s', (hideDemoBanner) => {
    useAuthStore.setState({ isDemoMode: true, hideDemoBanner });
    mockHealth = {
      lastError: 'No intervals.icu login stored',
      lastSuccessAt: null,
    };
    const { result } = renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.activeBanner).toBe(hideDemoBanner ? null : 'demo');
    expect(result.current.screenEdges.includes('top')).toBe(hideDemoBanner);
  });

  it('lets the offline banner win when there is no connection', () => {
    mockIsOnline = false;
    mockHealth = { lastError: 'HTTP 503', lastSuccessAt: null };
    const { result } = renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.activeBanner).toBe('offline');
  });

  it('leaves the top edge to the screen when the sync is healthy', () => {
    const { result } = renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.activeBanner).toBeNull();
    expect(result.current.screenEdges).toContain('top');
  });

  it('shows nothing to a signed-out user', () => {
    useAuthStore.setState({ isAuthenticated: false });
    mockHealth = { lastError: 'HTTP 503', lastSuccessAt: null };
    const { result } = renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.activeBanner).toBeNull();
  });
});

describe('TopSafeAreaProvider with the notices outside the sync', () => {
  beforeEach(() => {
    mockIsOnline = true;
    mockHealth = { lastError: null, lastSuccessAt: null };
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false, hideDemoBanner: false });
    act(() => {
      useEngineStatus.setState({ initFailed: false });
      useTrackFetchNotice.setState({ failedIds: [], failedCount: 0, dismissed: false });
    });
  });

  it('reserves the top edge for the track notice alone', () => {
    useTrackFetchNotice.setState({ failedIds: ['a', 'b', 'c'], failedCount: 3, dismissed: false });
    const { result } = renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.activeBanner).toBe('trackFetch');
    expect(result.current.screenEdges).not.toContain('top');
  });

  it('gives the edge back once the track notice is dismissed', () => {
    useTrackFetchNotice.setState({ failedIds: ['a'], failedCount: 1, dismissed: true });
    const { result } = renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.screenEdges).toContain('top');
  });

  it('reserves the top edge for a failed engine open', () => {
    useEngineStatus.setState({ initFailed: true });
    const { result } = renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.activeBanner).toBe('engineInit');
    expect(result.current.screenEdges).not.toContain('top');
  });
});
