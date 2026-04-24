/**
 * NetworkContext Tests
 *
 * Covers the Network provider state machine:
 * - Initial optimistic-online state
 * - Online-immediate and offline-debounced transitions
 * - Debounce clearing when network toggles back before 3s elapses
 * - Listener-first / getNetworkStateAsync fallback after 100ms
 * - Cleanup (unsubscribe + timer clear) on unmount
 * - useNetwork() throws when used outside provider
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

// Mock expo-network so we can drive addNetworkStateListener and getNetworkStateAsync.
// jest.mock factory runs before imports; its factory must not reference out-of-scope
// non-"mock"-prefixed variables. We expose state via globalThis so tests can drive it.
jest.mock('expo-network', () => {
  const mockState = {
    listener: null,
    remove: jest.fn(),
    getNetworkStateAsync: jest.fn(() => new Promise(() => {})), // never resolves by default
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__networkMock = mockState;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addNetworkStateListener: jest.fn((listener: any) => {
      mockState.listener = listener;
      return { remove: mockState.remove };
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getNetworkStateAsync: (...args: unknown[]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockState.getNetworkStateAsync as (...a: unknown[]) => any).apply(mockState, args),
  };
});

import { NetworkProvider, useNetwork } from '@/providers/NetworkContext';

type NetworkStateShape = {
  isConnected?: boolean;
  isInternetReachable?: boolean;
  type?: string | null;
};

// Helper to access the mock state from tests
function getMock() {
  return (
    globalThis as unknown as {
      __networkMock: {
        listener: ((state: NetworkStateShape) => void) | null;
        remove: jest.Mock;
        getNetworkStateAsync: jest.Mock;
      };
    }
  ).__networkMock;
}

function wrapperFor({ children }: { children: React.ReactNode }) {
  return <NetworkProvider>{children}</NetworkProvider>;
}

describe('NetworkContext', () => {
  beforeEach(() => {
    const mock = getMock();
    mock.listener = null;
    mock.remove.mockClear();
    mock.getNetworkStateAsync.mockReset();
    mock.getNetworkStateAsync.mockImplementation(() => new Promise(() => {}));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-network').addNetworkStateListener as jest.Mock).mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initial state', () => {
    it('starts online (optimistic)', () => {
      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      expect(result.current.isOnline).toBe(true);
      expect(result.current.isInternetReachable).toBeNull();
      expect(result.current.connectionType).toBeNull();
    });

    it('subscribes to network state listener on mount', () => {
      renderHook(() => useNetwork(), { wrapper: wrapperFor });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Network = require('expo-network');
      expect(Network.addNetworkStateListener).toHaveBeenCalledTimes(1);
      expect(getMock().listener).not.toBeNull();
    });
  });

  describe('online transition', () => {
    it('updates immediately when network reports connected and internet reachable', () => {
      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: true,
          type: 'WIFI',
        });
      });
      expect(result.current.isOnline).toBe(true);
      expect(result.current.isInternetReachable).toBe(true);
      expect(result.current.connectionType).toBe('WIFI');
    });

    it('coalesces null isInternetReachable to online (missing field)', () => {
      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: undefined,
          type: 'CELLULAR',
        });
      });
      // isInternetReachable !== false → treated as online
      expect(result.current.isOnline).toBe(true);
      expect(result.current.isInternetReachable).toBeNull();
      expect(result.current.connectionType).toBe('CELLULAR');
    });
  });

  describe('offline transition (debounced 3s)', () => {
    it('does NOT flip offline immediately', () => {
      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({
          isConnected: false,
          isInternetReachable: false,
          type: 'NONE',
        });
      });
      // Still optimistic-online because debounce hasn't elapsed
      expect(result.current.isOnline).toBe(true);
    });

    it('flips offline after 3s when offline state persists', () => {
      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({
          isConnected: false,
          isInternetReachable: false,
          type: 'NONE',
        });
      });

      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(result.current.isOnline).toBe(false);
      expect(result.current.isInternetReachable).toBe(false);
      expect(result.current.connectionType).toBe('NONE');
    });

    it('cancels debounce when network comes back online before 3s', () => {
      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });

      // First: go offline
      act(() => {
        getMock().listener!({
          isConnected: false,
          isInternetReachable: false,
          type: 'NONE',
        });
      });

      // Advance partially (< 3s)
      act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(result.current.isOnline).toBe(true);

      // Come back online
      act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: true,
          type: 'WIFI',
        });
      });
      expect(result.current.isOnline).toBe(true);
      expect(result.current.connectionType).toBe('WIFI');

      // Advance past the original 3s mark — no offline flip
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(result.current.isOnline).toBe(true);
    });

    it('treats isInternetReachable=false as offline even when isConnected=true', () => {
      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: false,
          type: 'WIFI',
        });
      });
      // Captive-portal scenario: has link but no internet
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(result.current.isOnline).toBe(false);
    });
  });

  describe('fallback: getNetworkStateAsync', () => {
    it('does NOT call getNetworkStateAsync if listener fires within 100ms', () => {
      renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: true,
          type: 'WIFI',
        });
      });
      act(() => {
        jest.advanceTimersByTime(150);
      });
      expect(getMock().getNetworkStateAsync).not.toHaveBeenCalled();
    });

    it('calls getNetworkStateAsync after 100ms when listener has NOT fired', async () => {
      getMock().getNetworkStateAsync.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'WIFI',
      });

      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(async () => {
        jest.advanceTimersByTime(100);
        // Flush any pending microtasks that the promise chain schedules
        await Promise.resolve();
      });
      expect(getMock().getNetworkStateAsync).toHaveBeenCalledTimes(1);
      expect(result.current.isOnline).toBe(true);
      expect(result.current.connectionType).toBe('WIFI');
    });

    it('does not override a listener-reported state that arrived first', () => {
      getMock().getNetworkStateAsync.mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
        type: 'NONE',
      });

      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });

      // Listener fires with online state immediately
      act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: true,
          type: 'WIFI',
        });
      });

      // Fallback timer advances; but since hasReceivedListenerUpdate is true,
      // getNetworkStateAsync should NOT be invoked
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(getMock().getNetworkStateAsync).not.toHaveBeenCalled();
      expect(result.current.isOnline).toBe(true);
    });
  });

  describe('cleanup on unmount', () => {
    it('removes the listener subscription', () => {
      const { unmount } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      unmount();
      expect(getMock().remove).toHaveBeenCalledTimes(1);
    });

    it('cancels pending offline debounce on unmount', () => {
      const { result, unmount } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({
          isConnected: false,
          isInternetReachable: false,
          type: 'NONE',
        });
      });
      unmount();
      // After unmount, the timer is cleared; advancing it must not crash
      // and must not flip state (we have no more result reference anyway)
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      // Result from before unmount is a snapshot — should still be optimistic
      expect(result.current.isOnline).toBe(true);
    });

    it('ignores getNetworkStateAsync resolution that arrives after unmount', async () => {
      let resolver: ((v: NetworkStateShape) => void) | null = null;
      getMock().getNetworkStateAsync.mockImplementation(
        () =>
          new Promise<NetworkStateShape>((resolve) => {
            resolver = resolve;
          })
      );

      const { unmount } = renderHook(() => useNetwork(), { wrapper: wrapperFor });

      // Trigger fallback path
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(getMock().getNetworkStateAsync).toHaveBeenCalledTimes(1);

      unmount();
      // Resolution after unmount must not throw
      await act(async () => {
        resolver!({
          isConnected: false,
          isInternetReachable: false,
          type: 'NONE',
        });
        await Promise.resolve();
      });
    });
  });

  describe('useNetwork() outside provider', () => {
    it('throws a clear error', () => {
      // Silence expected console.error from React
      const consoleErr = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderHook(() => useNetwork())).toThrow(
        /useNetwork must be used within a NetworkProvider/
      );
      consoleErr.mockRestore();
    });
  });
});
