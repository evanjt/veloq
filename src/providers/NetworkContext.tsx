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
    // Subscribe to network state updates
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      // Consider online if connected AND internet is reachable (or unknown)
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;

      setNetworkState({
        isOnline,
        isInternetReachable: state.isInternetReachable,
        connectionType: state.type,
      });
    });

    // Get initial state
    NetInfo.fetch().then((state: NetInfoState) => {
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;
      setNetworkState({
        isOnline,
        isInternetReachable: state.isInternetReachable,
        connectionType: state.type,
      });
    });

    return () => unsubscribe();
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
