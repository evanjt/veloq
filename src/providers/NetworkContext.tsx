import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as Network from 'expo-network';

interface NetworkContextValue {
  /** Whether device has network connectivity */
  isOnline: boolean;
  /** Whether internet is reachable (null if unknown) */
  isInternetReachable: boolean | null;
  /** Connection type (wifi, cellular, etc.) */
  connectionType: string | null;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkState, setNetworkState] = useState<NetworkContextValue>({
    isOnline: true, // Assume online initially
    isInternetReachable: null,
    connectionType: null,
  });

  useEffect(() => {
    // Track whether we've received an update from the listener
    // to avoid race condition with initial fetch
    let hasReceivedListenerUpdate = false;

    // Subscribe to network state updates
    const subscription = Network.addNetworkStateListener((state) => {
      hasReceivedListenerUpdate = true;
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;

      setNetworkState({
        isOnline,
        isInternetReachable: state.isInternetReachable ?? null,
        connectionType: state.type ?? null,
      });
    });

    // Fallback fetch only if listener doesn't fire within 100ms
    // This handles edge cases where addEventListener might not fire immediately
    const timeoutId = setTimeout(() => {
      if (!hasReceivedListenerUpdate) {
        Network.getNetworkStateAsync().then((state) => {
          // Only update if we still haven't received a listener update
          if (!hasReceivedListenerUpdate) {
            const isOnline = state.isConnected === true && state.isInternetReachable !== false;
            setNetworkState({
              isOnline,
              isInternetReachable: state.isInternetReachable ?? null,
              connectionType: state.type ?? null,
            });
          }
        });
      }
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      subscription.remove();
    };
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
