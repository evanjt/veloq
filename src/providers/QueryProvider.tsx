import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days - keep in memory longer for offline
      retry: 2,
      networkMode: 'offlineFirst',
      refetchOnReconnect: true,
    },
  },
});

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'veloq-query-cache',
  // Throttle writes to prevent overwhelming storage
  throttleTime: 2000,
  // Serialize with size limit - skip large entries
  serialize: (data) => {
    try {
      const serialized = JSON.stringify(data);
      // If cache is over 1MB, clear it and return empty
      if (serialized.length > 1024 * 1024) {
        return JSON.stringify({ clientState: { queries: [], mutations: [] } });
      }
      return serialized;
    } catch {
      return JSON.stringify({ clientState: { queries: [], mutations: [] } });
    }
  },
});

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  // Sync TanStack Query's online state with expo-network
  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      // Consider online if connected AND internet is reachable (or unknown)
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;
      onlineManager.setOnline(isOnline);
    });

    return () => subscription.remove();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: asyncStoragePersister,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days max age - match gcTime
        // Don't persist activity streams (large data)
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            // Never persist pending queries - they'll fail on rehydration
            // https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient#persistqueryclient
            if (query.state.status === 'pending') return false;

            const key = query.queryKey[0];
            // Skip persisting large data like streams
            if (key === 'activity-streams-v2') return false;
            return true;
          },
        },
      }}
      onError={() => {
        // Log cache error for debugging
        console.warn('[QueryProvider] Cache persistence error occurred');
        // Clear corrupted cache and reset query client state
        AsyncStorage.removeItem('veloq-query-cache')
          .then(() => {
            // Reset query client to ensure consistent state
            queryClient.clear();
            // Notify user that cache was cleared
            Alert.alert(
              'Cache Cleared',
              'Local data cache was corrupted and has been cleared. Your data will be refreshed from the server.',
              [{ text: 'OK' }]
            );
          })
          .catch((clearError) => {
            console.error('[QueryProvider] Failed to clear corrupted cache:', clearError);
          });
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
