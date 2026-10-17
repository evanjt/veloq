/**
 * NetworkContext Tests
 *
 * Covers the Network provider state machine:
 * - Initial optimistic-online state
 * - Online-immediate and offline-debounced transitions
 * - Debounce clearing when network toggles back before it elapses
 * - Listener-first / getNetworkStateAsync fallback after 100ms
 * - Cleanup (unsubscribe + timer clear) on unmount
 * - useNetwork() throws when used outside provider
 * - The same edge pushed into the Rust engine, plus a foreground re-push
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

import { onlineManager } from '@tanstack/react-query';

import { AppState } from 'react-native';

import {
  FOREGROUND_REREAD_MS,
  NetworkProvider,
  OFFLINE_DEBOUNCE_MS,
  useNetwork,
} from '@/shared/app/NetworkContext';

const mockSetNetworkOnline = jest.fn();
const mockReturnPushed = jest.fn();

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    connectivity: {
      setNetworkOnline: (online: boolean, foregrounded?: boolean) => {
        mockSetNetworkOnline(online);
        if (foregrounded) mockReturnPushed(online);
      },
      setInteracting: () => {},
    },
  })
);

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
    ...jest.requireActual('expo-network'),
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
  isConnected?: boolean | undefined;
  isInternetReachable?: boolean | undefined;
  type?: string | null | undefined;
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
    (require('expo-network').addNetworkStateListener as jest.Mock).mockClear();
    mockSetNetworkOnline.mockClear();
    mockReturnPushed.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initial state', () => {
    it('starts online (optimistic)', async () => {
      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      expect(result.current.isOnline).toBe(true);
    });

    it('subscribes to network state listener on mount', async () => {
      await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      const Network = require('expo-network');
      expect(Network.addNetworkStateListener).toHaveBeenCalledTimes(1);
      expect(getMock().listener).not.toBeNull();
    });
  });

  describe('online transition', () => {
    it('updates immediately when network reports connected and internet reachable', async () => {
      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: true,
          type: 'WIFI',
        });
      });
      expect(result.current.isOnline).toBe(true);
    });

    it('coalesces null isInternetReachable to online (missing field)', async () => {
      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
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

  describe('offline transition (debounced)', () => {
    /**
     * The debounce is for a hiccup between two known states, so every case
     * here starts from a reading that confirmed online. A drop reported before
     * any reading has come back is the cold boot, and it applies at once.
     */
    async function confirmOnline() {
      await act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });
    }

    it('does NOT flip offline immediately', async () => {
      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await confirmOnline();
      await act(() => {
        getMock().listener!({
          isConnected: false,
          isInternetReachable: false,
          type: 'NONE',
        });
      });
      // Still optimistic-online because debounce hasn't elapsed
      expect(result.current.isOnline).toBe(true);
    });

    it('flips offline after the debounce when offline state persists', async () => {
      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await confirmOnline();
      await act(() => {
        getMock().listener!({
          isConnected: false,
          isInternetReachable: false,
          type: 'NONE',
        });
      });

      await act(() => {
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });
      expect(result.current.isOnline).toBe(false);
    });

    it('cancels debounce when network comes back online before it elapses', async () => {
      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await confirmOnline();

      // First: go offline
      await act(() => {
        getMock().listener!({
          isConnected: false,
          isInternetReachable: false,
          type: 'NONE',
        });
      });

      // Advance partially, short of the debounce
      await act(() => {
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS - 500);
      });
      expect(result.current.isOnline).toBe(true);

      // Come back online
      await act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: true,
          type: 'WIFI',
        });
      });
      expect(result.current.isOnline).toBe(true);

      // Advance past the original debounce mark - no offline flip
      await act(() => {
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });
      expect(result.current.isOnline).toBe(true);
    });

    it('treats isInternetReachable=false as offline even when isConnected=true', async () => {
      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: false,
          type: 'WIFI',
        });
      });
      // Captive-portal scenario: has link but no internet
      await act(() => {
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });
      expect(result.current.isOnline).toBe(false);
    });
  });

  describe('fallback: getNetworkStateAsync', () => {
    it('does NOT call getNetworkStateAsync if listener fires within 100ms', async () => {
      await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: true,
          type: 'WIFI',
        });
      });
      await act(() => {
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

      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(async () => {
        jest.advanceTimersByTime(100);
        // Flush any pending microtasks that the promise chain schedules
        await Promise.resolve();
      });
      expect(getMock().getNetworkStateAsync).toHaveBeenCalledTimes(1);
      expect(result.current.isOnline).toBe(true);
    });

    it('does not override a listener-reported state that arrived first', async () => {
      getMock().getNetworkStateAsync.mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
        type: 'NONE',
      });

      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });

      // Listener fires with online state immediately
      await act(() => {
        getMock().listener!({
          isConnected: true,
          isInternetReachable: true,
          type: 'WIFI',
        });
      });

      // Fallback timer advances; but since hasReceivedListenerUpdate is true,
      // getNetworkStateAsync should NOT be invoked
      await act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(getMock().getNetworkStateAsync).not.toHaveBeenCalled();
      expect(result.current.isOnline).toBe(true);
    });
  });

  describe('cleanup on unmount', () => {
    it('removes the listener subscription', async () => {
      const { unmount } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await unmount();
      expect(getMock().remove).toHaveBeenCalledTimes(1);
    });

    it('cancels pending offline debounce on unmount', async () => {
      const { result, unmount } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      // A drop is only debounced once a reading has confirmed online.
      await act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });
      await act(() => {
        getMock().listener!({
          isConnected: false,
          isInternetReachable: false,
          type: 'NONE',
        });
      });
      await unmount();
      // After unmount, the timer is cleared; advancing it must not crash
      // and must not flip state (we have no more result reference anyway)
      await act(() => {
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

      const { unmount } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });

      // Trigger fallback path
      await act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(getMock().getNetworkStateAsync).toHaveBeenCalledTimes(1);

      await unmount();
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
    it('mirrors the provider state, so refetchOnReconnect is not dead', async () => {
      await renderHook(() => useNetwork(), { wrapper: wrapperFor });

      await act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });
      expect(onlineManager.isOnline()).toBe(false);

      await act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });
      expect(onlineManager.isOnline()).toBe(true);
    });

    it('leaves the manager online once the provider unmounts', async () => {
      const { unmount } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });

      await act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });
      await unmount();

      expect(onlineManager.isOnline()).toBe(true);
    });
  });

  /**
   * Scenario: the network lifecycle is Rust's, and the crate cannot see the
   * network. The push has to ride the edge this provider already
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

    it('pushes online on the same edge that sets onlineManager', async () => {
      await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });

      expect(mockSetNetworkOnline).toHaveBeenCalledWith(true);
    });

    it('pushes offline only after the debounce, not on the raw edge', async () => {
      await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });
      await act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
      });
      expect(mockSetNetworkOnline).not.toHaveBeenCalledWith(false);

      await act(() => {
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });
      expect(mockSetNetworkOnline).toHaveBeenCalledWith(false);
    });

    it('does not push offline when the network comes back inside the debounce', async () => {
      await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });
      await act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS - 500);
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });

      expect(mockSetNetworkOnline).not.toHaveBeenCalledWith(false);
    });

    /**
     * A state Rust cannot refresh is worse than none, so the provider
     * re-states what it knows every time the app comes back.
     */
    it('re-pushes the state it holds on foreground', async () => {
      await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });
      mockSetNetworkOnline.mockClear();

      await act(() => {
        appStateListeners.forEach((l) => l('active'));
      });

      expect(mockSetNetworkOnline).toHaveBeenCalledWith(false);
    });

    /**
     * Scenario: the listener's first reading says offline on a connection that
     * is in fact up, and the network then never changes, so `expo-network`
     * never fires again. The athlete backgrounds the app and comes back.
     *
     * Expected behaviour: the foreground re-reads the network rather than
     * re-stating what it holds. Without the re-read there is no other path
     * back: the listener fires on change, and the 100 ms fallback is armed
     * once and skipped for ever after the first delivery, so the app stays
     * offline for the life of the process on a working connection.
     */
    it('re-reads the network on foreground rather than trusting what it holds', async () => {
      await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
      });
      mockSetNetworkOnline.mockClear();
      getMock().getNetworkStateAsync.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'WIFI',
      });

      await act(async () => {
        appStateListeners.forEach((l) => l('active'));
        await Promise.resolve();
      });

      expect(getMock().getNetworkStateAsync).toHaveBeenCalled();
      expect(mockSetNetworkOnline).toHaveBeenCalledWith(true);
      expect(onlineManager.isOnline()).toBe(true);
    });

    /**
     * The re-read is an answer, not a seed, so a drop it reports goes through
     * the same debounce every other drop does. Two debounces that
     * disagree is what keeping one path avoids.
     */
    it('debounces a drop the foreground re-read brings back', async () => {
      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });
      getMock().getNetworkStateAsync.mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
        type: 'NONE',
      });

      await act(async () => {
        appStateListeners.forEach((l) => l('active'));
        await Promise.resolve();
      });
      expect(result.current.isOnline).toBe(true);

      await act(() => {
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });
      expect(result.current.isOnline).toBe(false);
    });

    /**
     * A re-read that will not answer leaves the last value standing, which is
     * what the engine already holds, so nothing is worse for having asked.
     */
    it('keeps what it holds when the re-read rejects', async () => {
      const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
      });
      getMock().getNetworkStateAsync.mockRejectedValue(new Error('no answer'));

      await act(async () => {
        appStateListeners.forEach((l) => l('active'));
        await Promise.resolve();
      });

      expect(result.current.isOnline).toBe(true);
      expect(mockSetNetworkOnline).toHaveBeenCalledWith(true);
    });

    /**
     * Scenario: the app stays open in the foreground, offline, for longer
     * than Rust believes a pushed state, with no network change and no trip
     * through the background. Rust's copy expires at an hour and the engine
     * starts asking a network the device still says is gone.
     *
     * Expected behaviour: while the app is active the provider re-states and
     * re-reads the network well inside that hour, and a backgrounded app,
     * which the window exists for, gets nothing.
     */
    describe('a long foreground session', () => {
      const STALE_AFTER_MS = 60 * 60 * 1000;
      const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');

      function setAppState(state: string) {
        Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
      }

      afterEach(() => {
        if (original) Object.defineProperty(AppState, 'currentState', original);
      });

      async function holdOffline() {
        await renderHook(() => useNetwork(), { wrapper: wrapperFor });
        await act(() => {
          getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        });
        mockSetNetworkOnline.mockClear();
        getMock().getNetworkStateAsync.mockClear();
      }

      it('pushes the held state again before the engine stops believing it', async () => {
        setAppState('active');
        await holdOffline();

        await act(() => {
          jest.advanceTimersByTime(STALE_AFTER_MS - 1);
        });

        expect(mockSetNetworkOnline).toHaveBeenCalledWith(false);
        expect(mockSetNetworkOnline).not.toHaveBeenCalledWith(true);
        expect(getMock().getNetworkStateAsync).toHaveBeenCalled();
      });

      it('sends what the re-read finds through the same path as every reading', async () => {
        setAppState('active');
        await holdOffline();
        getMock().getNetworkStateAsync.mockResolvedValue({
          isConnected: true,
          isInternetReachable: true,
          type: 'WIFI',
        });

        await act(async () => {
          jest.advanceTimersByTime(STALE_AFTER_MS - 1);
          await Promise.resolve();
        });

        expect(mockSetNetworkOnline).toHaveBeenCalledWith(true);
        expect(onlineManager.isOnline()).toBe(true);
      });

      it('asks nothing while the app sits in the background', async () => {
        setAppState('background');
        await holdOffline();

        await act(() => {
          jest.advanceTimersByTime(STALE_AFTER_MS * 2);
        });

        expect(mockSetNetworkOnline).not.toHaveBeenCalled();
        expect(getMock().getNetworkStateAsync).not.toHaveBeenCalled();
      });

      it('stops asking once the app leaves the foreground', async () => {
        setAppState('active');
        await holdOffline();

        await act(() => {
          appStateListeners.forEach((l) => l('background'));
        });
        await act(() => {
          jest.advanceTimersByTime(STALE_AFTER_MS * 2);
        });

        expect(mockSetNetworkOnline).not.toHaveBeenCalled();
        expect(getMock().getNetworkStateAsync).not.toHaveBeenCalled();
      });

      it('starts asking again when a backgrounded app comes back', async () => {
        setAppState('background');
        await holdOffline();

        await act(() => {
          appStateListeners.forEach((l) => l('active'));
        });
        mockSetNetworkOnline.mockClear();
        await act(() => {
          jest.advanceTimersByTime(STALE_AFTER_MS - 1);
        });

        expect(mockSetNetworkOnline).toHaveBeenCalledWith(false);
      });
    });

    /**
     * Scenario: the athlete leaves the app and comes back. What a return
     * starts is the engine's to decide, so the provider's push on the way
     * back up says it is one.
     *
     * Expected behaviour: only an `active` after a `background` is marked a
     * return. iOS drops to `inactive` for a notification shade, and the clock
     * re-states what it holds every quarter hour, and neither is a return.
     */
    describe('a return from the background', () => {
      it('marks the push on the way back up as a return', async () => {
        await renderHook(() => useNetwork(), { wrapper: wrapperFor });

        await act(() => {
          appStateListeners.forEach((l) => l('background'));
        });
        expect(mockReturnPushed).not.toHaveBeenCalled();
        await act(() => {
          appStateListeners.forEach((l) => l('active'));
        });

        expect(mockReturnPushed).toHaveBeenCalledTimes(1);
        expect(mockReturnPushed).toHaveBeenCalledWith(true);
      });

      it('marks each return once, not the active that follows a flicker', async () => {
        await renderHook(() => useNetwork(), { wrapper: wrapperFor });

        await act(() => {
          appStateListeners.forEach((l) => l('background'));
          appStateListeners.forEach((l) => l('active'));
          appStateListeners.forEach((l) => l('inactive'));
          appStateListeners.forEach((l) => l('active'));
        });

        expect(mockReturnPushed).toHaveBeenCalledTimes(1);
      });

      it('does not mark a pass through inactive as a return', async () => {
        await renderHook(() => useNetwork(), { wrapper: wrapperFor });
        mockSetNetworkOnline.mockClear();

        await act(() => {
          appStateListeners.forEach((l) => l('inactive'));
          appStateListeners.forEach((l) => l('active'));
        });

        expect(mockSetNetworkOnline).toHaveBeenCalled();
        expect(mockReturnPushed).not.toHaveBeenCalled();
      });

      it('does not mark the quarter-hour re-read as a return', async () => {
        const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
        Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
        try {
          await renderHook(() => useNetwork(), { wrapper: wrapperFor });
          mockSetNetworkOnline.mockClear();

          await act(() => {
            jest.advanceTimersByTime(FOREGROUND_REREAD_MS);
          });

          expect(mockSetNetworkOnline).toHaveBeenCalled();
          expect(mockReturnPushed).not.toHaveBeenCalled();
        } finally {
          if (original) Object.defineProperty(AppState, 'currentState', original);
        }
      });

      it('carries the reading it holds, offline included', async () => {
        await renderHook(() => useNetwork(), { wrapper: wrapperFor });
        await act(() => {
          getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
          jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
        });

        await act(() => {
          appStateListeners.forEach((l) => l('background'));
          appStateListeners.forEach((l) => l('active'));
        });

        expect(mockReturnPushed).toHaveBeenCalledWith(false);
      });
    });

    it('releases the engine on unmount, so nothing is left refusing work', async () => {
      const { unmount } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });
      await act(() => {
        getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
        jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
      });
      mockSetNetworkOnline.mockClear();

      await unmount();

      expect(mockSetNetworkOnline).toHaveBeenCalledWith(true);
    });
  });

  describe('useNetwork() outside provider', () => {
    it('throws a clear error', async () => {
      // Silence expected console.error from React
      const consoleErr = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect((async () => renderHook(() => useNetwork()))()).rejects.toThrow(
        /useNetwork must be used within a NetworkProvider/
      );
      consoleErr.mockRestore();
    });
  });
});

/**
 * Scenario: a cold boot in aeroplane mode. The provider seeds online because
 * nothing has answered yet, and the first reading that comes back says
 * offline.
 *
 * Expected behaviour: that first reading applies at once. The debounce is
 * there to stop the banner flashing on a hiccup between two known states, and
 * a seed that no reading has confirmed is not a state to debounce away from.
 * Without this, every mount effect in that debounce takes the online
 * branch and latches on it.
 */
describe('the first reading after a cold boot', () => {
  beforeEach(() => {
    const mock = getMock();
    mock.listener = null;
    mock.remove.mockClear();
    mock.getNetworkStateAsync.mockReset();
    mock.getNetworkStateAsync.mockImplementation(() => new Promise(() => {}));
    (require('expo-network').addNetworkStateListener as jest.Mock).mockClear();
    mockSetNetworkOnline.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('goes offline at once rather than after the debounce', async () => {
    const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });

    await act(() => {
      getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    });

    expect(result.current.isOnline).toBe(false);
    expect(onlineManager.isOnline()).toBe(false);
    expect(mockSetNetworkOnline).toHaveBeenCalledWith(false);
  });

  it('still debounces a drop once a reading has confirmed online', async () => {
    const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });

    await act(() => {
      getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
    });
    await act(() => {
      getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    });

    expect(result.current.isOnline).toBe(true);

    await act(() => {
      jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
    });

    expect(result.current.isOnline).toBe(false);
  });

  it('debounces a drop that follows a confirmed offline, coming back online between', async () => {
    const { result } = await renderHook(() => useNetwork(), { wrapper: wrapperFor });

    await act(() => {
      getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    });
    await act(() => {
      getMock().listener!({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
    });
    await act(() => {
      getMock().listener!({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    });

    expect(result.current.isOnline).toBe(true);
    await act(() => {
      jest.advanceTimersByTime(OFFLINE_DEBOUNCE_MS);
    });
    expect(result.current.isOnline).toBe(false);
  });
});
