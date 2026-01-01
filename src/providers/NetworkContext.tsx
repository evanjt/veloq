import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

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
    // Note: The listener fires immediately with current state, so we don't need
    // a separate fetch() call which could cause a race condition
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      hasReceivedListenerUpdate = true;
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;

      setNetworkState({
        isOnline,
        isInternetReachable: state.isInternetReachable,
        connectionType: state.type,
      });
    });

    // Fallback fetch only if listener doesn't fire within 100ms
    // This handles edge cases where addEventListener might not fire immediately
    const timeoutId = setTimeout(() => {
      if (!hasReceivedListenerUpdate) {
        NetInfo.fetch().then((state: NetInfoState) => {
          // Only update if we still haven't received a listener update
          if (!hasReceivedListenerUpdate) {
            const isOnline = state.isConnected === true && state.isInternetReachable !== false;
            setNetworkState({
              isOnline,
              isInternetReachable: state.isInternetReachable,
              connectionType: state.type,
            });
          }
        });
      }
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  return (
    <NetworkContext.Provider value={networkState}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
