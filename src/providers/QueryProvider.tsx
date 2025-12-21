import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 1 day (reduced from 7)
      retry: 2,
      networkMode: 'offlineFirst',
    },
  },
});

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'velox-query-cache',
  // Throttle writes to prevent overwhelming storage
  throttleTime: 2000,
  // Serialize with size limit - skip large entries
  serialize: (data) => {
    try {
      const serialized = JSON.stringify(data);
      // If cache is over 1MB, clear it and return empty
      if (serialized.length > 1024 * 1024) {
        console.warn('Cache too large, skipping persist');
        return JSON.stringify({ clientState: { queries: [], mutations: [] } });
      }
      return serialized;
    } catch (e) {
      console.warn('Failed to serialize cache:', e);
      return JSON.stringify({ clientState: { queries: [], mutations: [] } });
    }
  },
});

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: asyncStoragePersister,
        maxAge: 1000 * 60 * 60 * 24, // 1 day max age
        // Don't persist activity streams (large data)
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            const key = query.queryKey[0];
            // Skip persisting large data like streams
            if (key === 'activity-streams-v2') return false;
            return true;
          },
        },
      }}
      onError={(error) => {
        console.warn('Query persist error:', error);
        // Clear corrupted cache
        AsyncStorage.removeItem('velox-query-cache').catch(() => {});
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
