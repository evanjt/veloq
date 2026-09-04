import React from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      // In-memory cache eviction. Kept short so a long browsing session over a
      // large activity history doesn't pin every visited query (feed cards,
      // charts, sections) in the Hermes heap.
      gcTime: 1000 * 60 * 60 * 2, // 2 hours
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

/**
 * Free the blob written by the persisted query cache that this provider used to
 * run. Nothing reads it any more: every queryFn reads the engine, which rebuilds
 * a key from SQLite faster than the blob can be read and parsed. Remove this
 * once the release carrying it has shipped.
 */
export async function clearLegacyQueryCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem('veloq-query-cache');
  } catch {
    // A blob nobody reads is not worth an error path.
  }
}
void clearLegacyQueryCache();

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
