import React from 'react';
import { Alert, AppState, Platform, type AppStateStatus } from 'react-native';
import { i18n } from '@/i18n';
import { QueryClient, focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isInfiniteActivitiesStale } from '@/hooks/activities/useActivities';
import { queryKeys } from '@/lib/queryKeys';

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

/** Empty cache payload — reused to avoid allocating a new string each write */
const EMPTY_CACHE = '{"clientState":{"queries":[],"mutations":[]}}';

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'veloq-query-cache',
  // Throttle writes to prevent overwhelming storage
  throttleTime: 2000,
  // Serialize with size limit — skip entire write when over 1MB.
  // The persister calls serialize() every throttleTime (2s). Without the
  // query-count guard, JSON.stringify on a large cache allocates a multi-MB
  // string every 2s only to discard it when it exceeds the limit.
  serialize: (data) => {
    try {
      // Fast pre-check: if many queries are cached, the serialized form is
      // almost certainly over 1MB. Skip the expensive stringify entirely.
      const queries = (data as { clientState?: { queries?: unknown[] } })?.clientState?.queries;
      if (queries && queries.length > 200) {
        return EMPTY_CACHE;
      }
      const serialized = JSON.stringify(data);
      if (serialized.length > 1024 * 1024) {
        return EMPTY_CACHE;
      }
      return serialized;
    } catch {
      return EMPTY_CACHE;
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
        maxAge: 1000 * 60 * 60 * 24, // 24 hours — match default gcTime
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
            // Skip fixed-range activity queries (date params become stale across sessions)
            if (key === 'activities') return false;
            return true;
          },
        },
      }}
      onSuccess={() => {
        // After restoring persisted cache, check if the infinite activities query
        // has stale page params (newest date is not today). If so, reset it so
        // initialPageParam is re-evaluated with today's date — otherwise the feed
        // will never fetch today's activities since invalidateQueries reuses stored params.
        if (isInfiniteActivitiesStale(queryClient)) {
          queryClient.resetQueries({ queryKey: queryKeys.activities.infinite.all });
        }
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
            Alert.alert(i18n.t('alerts.cacheCleared'), i18n.t('alerts.cacheCorruptionMessage'), [
              { text: i18n.t('common.ok') },
            ]);
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
