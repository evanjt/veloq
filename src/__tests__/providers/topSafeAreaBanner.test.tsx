/**
 * Screens drop their own top edge whenever a banner owns the top inset. The
 * sync-error banner sits in that same slot, so it has to be part of the
 * provider's answer or the banner and the screen both pad the notch.
 */

import React from 'react';
import { renderHook } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { TopSafeAreaProvider, useTopSafeArea } from '@/shared/app/TopSafeAreaContext';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline }),
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
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false, hideDemoBanner: false });
  });

  it('reserves the top edge for the sync-error banner', () => {
    mockHealth = { lastError: 'HTTP 503', lastSuccessAt: null };
    const { result } = renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.activeBanner).toBe('syncError');
    expect(result.current.hasTopBanner).toBe(true);
    expect(result.current.screenEdges).not.toContain('top');
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
