import React, { useEffect } from 'react';
import { Alert, AppState, Platform, type AppStateStatus } from 'react-native';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';

// Sync TanStack Query's focus state with React Native AppState
// Module-level so it's active before any query runs
// https://tanstack.com/query/latest/docs/framework/react/react-native#refetch-on-app-focus
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
}
AppState.addEventListener('change', onAppStateChange);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24 hours - reduced from 7 days to prevent memory bloat
      retry: 2,
      networkMode: 'offlineFirst',
      refetchOnReconnect: true,
      // Prevent refetches on every screen navigation - only refetch on explicit pull-to-refresh
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Export for manual cache management (e.g., clearing on navigation)
export { queryClient };

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'veloq-query-cache',
  // Throttle writes to prevent overwhelming storage
  throttleTime: 2000,
  // Serialize with size limit - skip large entries
  serialize: (data) => {
    try {
      const serialized = JSON.stringify(data);
      // If cache is over 1MB, clear it and return empty (use cached string to avoid object creation)
      if (serialized.length > 1024 * 1024) {
        return '{"clientState":{"queries":[],"mutations":[]}}';
      }
      return serialized;
    } catch {
      return '{"clientState":{"queries":[],"mutations":[]}}';
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
            // Skip persisting large data like streams (100-500KB per activity)
            if (key === 'activity-streams-v3') return false;
            // Also skip individual activity data (we persist the list, not each activity)
            if (key === 'activity') return false;
            return true;
          },
        },
      }}
      onError={() => {
        // Log cache error for debugging
        if (__DEV__) {
          console.warn('[QueryProvider] Cache persistence error occurred');
        }
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
            if (__DEV__) {
              console.error('[QueryProvider] Failed to clear corrupted cache:', clearError);
            }
          });
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
