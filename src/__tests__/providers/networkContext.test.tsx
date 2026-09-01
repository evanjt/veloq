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
 * - The same edge pushed into the Rust engine, plus a foreground re-push
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

import { onlineManager } from '@tanstack/react-query';

import { AppState } from 'react-native';

import { NetworkProvider, useNetwork } from '@/shared/app/NetworkContext';

const mockSetNetworkOnline = jest.fn();
const mockGetEngine = jest.fn(() => ({ setNetworkOnline: mockSetNetworkOnline }));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockGetEngine(),
}));

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

    getNetworkStateAsync: (...args: unknown[]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockState.getNetworkStateAsync as (...a: unknown[]) => any).apply(mockState, args),
  };
});

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
    mockSetNetworkOnline.mockClear();
    mockGetEngine.mockClear();
    mockGetEngine.mockImplementation(() => ({ setNetworkOnline: mockSetNetworkOnline }));
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initial state', () => {
    it('starts online (optimistic)', () => {
      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      expect(result.current.isOnline).toBe(true);
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

      // Advance past the original 3s mark - no offline flip
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
      // Result from before unmount is a snapshot - should still be optimistic
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

  describe('TanStack onlineManager', () => {
    it('mirrors the provider state, so refetchOnReconnect is not dead', () => {
      renderHook(() => useNetwork(), { wrapper: wrapperFor });

      act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(3000);
      });
      expect(onlineManager.isOnline()).toBe(false);

      act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });
      expect(onlineManager.isOnline()).toBe(true);
    });

    it('leaves the manager online once the provider unmounts', () => {
      const { unmount } = renderHook(() => useNetwork(), { wrapper: wrapperFor });

      act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(3000);
      });
      unmount();

      expect(onlineManager.isOnline()).toBe(true);
    });
  });

  /**
   * Scenario: `Q65` put the network lifecycle in Rust, and the crate cannot
   * see the network. The push has to ride the edge this provider already
   * debounces, or the app would run two debounces that disagree.
   */
  describe('the push into the engine', () => {
    let appStateListeners: ((s: string) => void)[] = [];

    beforeEach(() => {
      appStateListeners = [];
      jest.spyOn(AppState, 'addEventListener').mockImplementation(((
        _event: string,
        handler: (s: string) => void
      ) => {
        appStateListeners.push(handler);
        return { remove: jest.fn() };
      }) as unknown as typeof AppState.addEventListener);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('pushes online on the same edge that sets onlineManager', () => {
      renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });

      expect(mockSetNetworkOnline).toHaveBeenCalledWith(true);
    });

    it('pushes offline only after the 3s debounce, not on the raw edge', () => {
      renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
      });
      expect(mockSetNetworkOnline).not.toHaveBeenCalledWith(false);

      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(mockSetNetworkOnline).toHaveBeenCalledWith(false);
    });

    it('does not push offline when the network comes back inside the debounce', () => {
      renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(1500);
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
        jest.advanceTimersByTime(3000);
      });

      expect(mockSetNetworkOnline).not.toHaveBeenCalledWith(false);
    });

    /**
     * A state Rust cannot refresh is worse than none, so the provider
     * re-states what it knows every time the app comes back.
     */
    it('re-pushes the state it holds on foreground', () => {
      renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(3000);
      });
      mockSetNetworkOnline.mockClear();

      act(() => {
        appStateListeners.forEach((l) => l('active'));
      });

      expect(mockSetNetworkOnline).toHaveBeenCalledWith(false);
    });

    it('releases the engine on unmount, so nothing is left refusing work', () => {
      const { unmount } = renderHook(() => useNetwork(), { wrapper: wrapperFor });
      act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(3000);
      });
      mockSetNetworkOnline.mockClear();

      unmount();

      expect(mockSetNetworkOnline).toHaveBeenCalledWith(true);
    });

    /**
     * The provider mounts before `initWithPath`, so the module may not be
     * there yet. A push that throws must not take the provider down with it.
     */
    it('survives an engine that is not loaded', () => {
      mockGetEngine.mockImplementation(() => null as never);
      const { result } = renderHook(() => useNetwork(), { wrapper: wrapperFor });

      act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });

      expect(result.current.isOnline).toBe(true);
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
