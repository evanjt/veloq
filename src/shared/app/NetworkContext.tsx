import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { onlineManager } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';

interface NetworkContextValue {
  /** Whether device has network connectivity */
  isOnline: boolean;
  /** Whether internet is reachable (null if unknown) */
  isInternetReachable: boolean | null;
  /** Connection type (wifi, cellular, etc.) */
  connectionType: string | null;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

/**
 * Hand the edge to Rust as well as to TanStack.
 *
 * `Q65` put the network lifecycle in Rust, and nothing in the crate can see
 * the network, so this is its only input. It rides the debounced edge below
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
  const [networkState, setNetworkState] = useState<NetworkContextValue>({
    isOnline: true, // Assume online initially
    isInternetReachable: null,
    connectionType: null,
  });

  // Debounce timer for going-offline transitions (3s delay prevents OfflineBanner flashing)
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Cancellation flag to prevent state updates after unmount
    // and to coordinate between listener and fallback fetch
    let cancelled = false;
    let hasReceivedListenerUpdate = false;

    const applyNetworkState = (state: Network.NetworkState) => {
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;

      // Clear any pending offline timer
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }

      if (isOnline) {
        // Going online: update immediately
        setNetworkState({
          isOnline: true,
          isInternetReachable: state.isInternetReachable ?? null,
          connectionType: state.type ?? null,
        });
        // TanStack has no React Native connectivity source of its own, so
        // without this it believes it is permanently online and
        // `refetchOnReconnect` never fires.
        onlineManager.setOnline(true);
        pushToEngine(true);
      } else {
        // Going offline: debounce by 3s to avoid flashing during brief hiccups
        offlineTimerRef.current = setTimeout(() => {
          if (cancelled) return;
          setNetworkState({
            isOnline: false,
            isInternetReachable: state.isInternetReachable ?? null,
            connectionType: state.type ?? null,
          });
          onlineManager.setOnline(false);
          pushToEngine(false);
        }, 3000);
      }
    };

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
      subscription.remove();
      // Nothing is watching the network any more, so leaving the manager
      // offline would strand every query behind `networkMode`.
      onlineManager.setOnline(true);
      pushToEngine(true);
    };
  }, []);

  // The push is a value Rust holds, not a subscription, so it goes stale
  // while the app is backgrounded and no listener fires. Re-stating what we
  // already know on every foreground is what keeps Rust from refusing work on
  // a connection that came back while nobody was watching.
  const onlineRef = useRef(networkState.isOnline);
  useEffect(() => {
    onlineRef.current = networkState.isOnline;
  });
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') pushToEngine(onlineRef.current);
    });
    return () => subscription.remove();
  }, []);

  return <NetworkContext.Provider value={networkState}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
