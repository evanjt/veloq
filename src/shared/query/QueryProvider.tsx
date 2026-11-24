import React from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';

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
      // Every queryFn reads the engine's on-device SQLite and the network belongs to
      // Rust, so no query is gated on the online manager. Under `offlineFirst` a
      // retry after one thrown read pauses while the manager says offline.
      // `refetchOnReconnect` still reads the manager.
      networkMode: 'always',
      refetchOnReconnect: true,
      // Prevent refetches on every screen navigation - only refetch on explicit pull-to-refresh
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Export for manual cache management (e.g., clearing on navigation)
export { queryClient };

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
