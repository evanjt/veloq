import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { onlineManager } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';

interface NetworkContextValue {
  /** Whether device has network connectivity */
  isOnline: boolean;
  /**
   * Whether the offline banner is up. It trails `isOnline` going false by
   * `OFFLINE_BANNER_DELAY_MS` and follows it back on the same render, so the
   * banner and the top edge it takes move together.
   */
  offlineBannerShown: boolean;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

/**
 * How often an app held open in the foreground re-reads the network. A
 * quarter of the hour Rust believes a pushed state for (`STALE_AFTER` in
 * `net/connectivity.rs`), so the engine's copy never ages out while the app
 * is on screen, at one native read every quarter hour.
 */
export const FOREGROUND_REREAD_MS = 15 * 60 * 1000;

/**
 * How long the banner waits after `isOnline` goes false, on top of the three
 * second debounce. A network handoff can report the internet unreachable for
 * longer than the debounce, and a banner that slides in and out again moves
 * every screen's top edge twice for nothing.
 */
export const OFFLINE_BANNER_DELAY_MS = 5000;

/**
 * Hand the edge to Rust as well as to TanStack.
 *
 * The network lifecycle is Rust's, and nothing in the crate can see the
 * network, so this is its only input. It rides the debounced edge below
 * rather than the raw one, so the app runs one debounce rather than two.
 *
 * A push that cannot land is not worth failing over: the provider mounts
 * before `initWithPath`, the value is advisory in Rust, and it expires there,
 * so a dropped push costs a deferred pass at worst.
 */
function pushToEngine(online: boolean): void {
  try {
    getEngine()?.setNetworkOnline(online);
  } catch {
    // The native module is not loaded yet. The next edge or foreground
    // re-states it, and until then Rust behaves as it did before it had one.
  }
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkState, setNetworkState] = useState<{ isOnline: boolean }>({
    isOnline: true, // Assume online initially
  });

  // Whether an offline spell has lasted the banner's delay. Read only beside
  // `isOnline` below, so an online reading hides the banner on the render it
  // lands. Armed where `isOnline` goes false and cleared where it comes back.
  const [bannerDue, setBannerDue] = useState(false);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce timer for going-offline transitions (3s delay prevents OfflineBanner flashing)
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Whether any reading has come back yet. `isOnline` above is a seed, not an
  // answer, so the first reading is not a transition and is not debounced: a
  // cold boot in aeroplane mode otherwise reads as online for three seconds
  // and every mount effect in that window latches on the online branch.
  const hasReadingRef = useRef(false);

  useEffect(() => {
    // Cancellation flag to prevent state updates after unmount
    // and to coordinate between listener and fallback fetch
    let cancelled = false;
    let hasReceivedListenerUpdate = false;

    const clearBannerTimer = () => {
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
    };

    const goOffline = () => {
      setNetworkState({ isOnline: false });
      onlineManager.setOnline(false);
      pushToEngine(false);
      // An offline reading while the delay is counting leaves it counting, so
      // a re-read inside the spell does not push the banner further out.
      if (bannerTimerRef.current === null) {
        bannerTimerRef.current = setTimeout(() => {
          bannerTimerRef.current = null;
          if (!cancelled) setBannerDue(true);
        }, OFFLINE_BANNER_DELAY_MS);
      }
    };

    const applyNetworkState = (state: Network.NetworkState) => {
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;

      // Clear any pending offline timer
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }

      if (isOnline) {
        // Going online: update immediately
        clearBannerTimer();
        setBannerDue(false);
        setNetworkState({ isOnline: true });
        // TanStack has no React Native connectivity source of its own, so
        // without this it believes it is permanently online and
        // `refetchOnReconnect` never fires.
        onlineManager.setOnline(true);
        pushToEngine(true);
      } else if (!hasReadingRef.current) {
        // The first reading is the answer the seed was standing in for.
        goOffline();
      } else {
        // Going offline: debounce by 3s to avoid flashing during brief hiccups
        offlineTimerRef.current = setTimeout(() => {
          if (cancelled) return;
          goOffline();
        }, 3000);
      }

      hasReadingRef.current = true;
    };
    applyRef.current = applyNetworkState;

    // Subscribe to network state updates
    const subscription = Network.addNetworkStateListener((state) => {
      if (cancelled) return;
      hasReceivedListenerUpdate = true;
      applyNetworkState(state);
    });

    // Fallback fetch only if listener doesn't fire within 100ms
    // This handles edge cases where addEventListener might not fire immediately
    const timeoutId = setTimeout(() => {
      if (cancelled || hasReceivedListenerUpdate) return;

      Network.getNetworkStateAsync().then((state) => {
        // Check both flags after async operation completes
        if (cancelled || hasReceivedListenerUpdate) return;
        applyNetworkState(state);
      });
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
      }
      clearBannerTimer();
      subscription.remove();
      // Nothing is watching the network any more, so leaving the manager
      // offline would strand every query behind `networkMode`.
      onlineManager.setOnline(true);
      pushToEngine(true);
    };
  }, []);

  // Nothing else re-reads the network. The listener fires on change, so a
  // connection that never changes never produces a second reading, and the
  // 100 ms fallback is armed once and skipped for ever after the first
  // delivery. So a first reading that says offline on a working connection
  // stood for the life of the process, with the banner up, the sync stopped
  // and Rust refusing network work. The foreground asks again rather than
  // repeating what it holds.
  //
  // The answer goes through `applyNetworkState`, not around it: that is where
  // an online edge applies at once and a drop waits three seconds, and two
  // paths that debounce differently is what one path avoids. The value already
  // held is pushed first, because Rust's copy expires and a re-read that never
  // answers must not leave it expired.
  const onlineRef = useRef(networkState.isOnline);
  useEffect(() => {
    onlineRef.current = networkState.isOnline;
  });
  const applyRef = useRef<(state: Network.NetworkState) => void>(() => {});
  useEffect(() => {
    const restate = () => {
      pushToEngine(onlineRef.current);
      Network.getNetworkStateAsync()
        .then((state) => applyRef.current(state))
        .catch(() => {
          // A reading that will not come back leaves the last one standing,
          // which is what the engine was just handed.
        });
    };

    // Rust stops believing a push after `STALE_AFTER`, an hour, which is
    // meant for an app nobody opens. An app held open with no network change
    // gets no foreground and no listener event, so it is re-stated on a clock
    // while it is active, and never while it is not.
    let interval: ReturnType<typeof setInterval> | null = null;
    const startClock = () => {
      if (interval === null) interval = setInterval(restate, FOREGROUND_REREAD_MS);
    };
    const stopClock = () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
    };
    if (AppState.currentState === 'active') startClock();

    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') {
        stopClock();
        return;
      }
      restate();
      startClock();
    });
    return () => {
      stopClock();
      subscription.remove();
    };
  }, []);

  const value = useMemo(
    () => ({
      isOnline: networkState.isOnline,
      offlineBannerShown: !networkState.isOnline && bannerDue,
    }),
    [networkState.isOnline, bannerDue]
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

/**
 * Connectivity for a surface that has to render whether or not a provider is
 * above it. A map is mounted in previews, snapshots and tests with no app
 * shell, and a missing provider must not be what stops it drawing, so the
 * answer there is online, which is what every surface assumed before any of
 * them asked.
 */
export function useIsOnline(): boolean {
  return useContext(NetworkContext)?.isOnline ?? true;
}

export function useNetwork(): NetworkContextValue {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
