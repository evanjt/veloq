/**
 * QueryProvider Tests
 *
 * Covers the persistence configuration that backs the 47 GB storage-leak fix:
 * - Pre-check: more than 200 cached queries → skip serialization (return EMPTY_CACHE)
 * - Serialized length > 1 MB → return EMPTY_CACHE
 * - JSON.stringify throws → return EMPTY_CACHE
 * - maxAge: 24 hours is configured on persistOptions
 * - dehydrateOptions.shouldDehydrateQuery excludes pending queries,
 *   activity-streams-v3, activity, and activities (stale range) queries
 * - onError handler clears AsyncStorage and resets the query client
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// jest.mock factories are hoisted before all imports and `const` declarations.
// Any state the factory references must either be declared inside the factory
// (and exposed via globalThis) or named with a `mock` prefix.

jest.mock('@tanstack/query-async-storage-persister', () => {
  const state: { options: any } = { options: null };
  (globalThis as any).__persisterCapture = state;
  return {
    createAsyncStoragePersister: (opts: any) => {
      state.options = opts;
      return {
        persistClient: jest.fn(),
        restoreClient: jest.fn().mockResolvedValue(undefined),
        removeClient: jest.fn().mockResolvedValue(undefined),
      };
    },
  };
});

jest.mock('@tanstack/react-query-persist-client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const state: { props: any } = { props: null };
  (globalThis as any).__providerCapture = state;
  return {
    PersistQueryClientProvider: (props: any) => {
      state.props = props;
      return React.createElement(React.Fragment, null, props.children);
    },
  };
});

function persisterCapture() {
  return (globalThis as any).__persisterCapture as { options: any };
}
function providerCapture() {
  return (globalThis as any).__providerCapture as { props: any };
}

// Don't mock @tanstack/react-query — use the real QueryClient / focusManager

// Stub isInfiniteActivitiesStale so onSuccess can be exercised without pulling in
// the full activities module (which drags in auth store, queryKeys, etc.)
const mockIsInfiniteActivitiesStale = jest.fn().mockReturnValue(false);
jest.mock('@/hooks/activities/useActivities', () => ({
  isInfiniteActivitiesStale: (...args: any[]) => mockIsInfiniteActivitiesStale(...args),
}));

// Minimal queryKeys stub to avoid importing the auth-coupled module tree
jest.mock('@/lib/queryKeys', () => ({
  queryKeys: {
    activities: {
      infinite: {
        all: ['activities-infinite'],
      },
    },
  },
}));

// i18n mock - provide a simple t() that returns the key
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
}));

import React from 'react';
import { render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, AppState } from 'react-native';
import { focusManager, QueryClient } from '@tanstack/react-query';

// Silence Alert.alert at runtime (not via jest.mock to avoid TurboModule init).
jest.spyOn(Alert, 'alert').mockImplementation(() => {});

// Capture the AppState change listener so we can exercise onAppStateChange.
// NB: the QueryProvider module registers its listener at import time (line 19),
// so the spy MUST be installed BEFORE QueryProvider is first required.
const capturedAppStateListeners: Array<(status: string) => void> = [];
jest.spyOn(AppState, 'addEventListener').mockImplementation((event: any, listener: any) => {
  if (event === 'change') capturedAppStateListeners.push(listener);
  return { remove: jest.fn() } as any;
});

// Deferred require: QueryProvider.tsx runs its top-level side effects here,
// AFTER the AppState spy is in place. Using `require` avoids the ES-module
// import-hoisting that would otherwise defeat the spy.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QueryProviderModule =
  require('@/providers/QueryProvider') as typeof import('@/providers/QueryProvider');
const { QueryProvider } = QueryProviderModule;
const queryClient: QueryClient = QueryProviderModule.queryClient;

describe('QueryProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryClient.clear();
  });

  describe('module-level queryClient configuration', () => {
    it('sets staleTime to 5 minutes', () => {
      const defaults = queryClient.getDefaultOptions().queries!;
      expect(defaults.staleTime).toBe(1000 * 60 * 5);
    });

    it('sets gcTime to 24 hours (reduced from 7d to prevent memory bloat)', () => {
      const defaults = queryClient.getDefaultOptions().queries!;
      expect(defaults.gcTime).toBe(1000 * 60 * 60 * 24);
    });

    it('uses offlineFirst network mode and retry=2', () => {
      const defaults = queryClient.getDefaultOptions().queries!;
      expect(defaults.networkMode).toBe('offlineFirst');
      expect(defaults.retry).toBe(2);
    });

    it('disables refetchOnMount and refetchOnWindowFocus', () => {
      const defaults = queryClient.getDefaultOptions().queries!;
      expect(defaults.refetchOnMount).toBe(false);
      expect(defaults.refetchOnWindowFocus).toBe(false);
      expect(defaults.refetchOnReconnect).toBe(true);
    });
  });

  describe('persister configuration', () => {
    it('uses the veloq-query-cache key', () => {
      expect(persisterCapture().options).not.toBeNull();
      expect(persisterCapture().options.key).toBe('veloq-query-cache');
    });

    it('uses 2 second throttleTime', () => {
      expect(persisterCapture().options.throttleTime).toBe(2000);
    });

    it('passes AsyncStorage as storage', () => {
      expect(persisterCapture().options.storage).toBe(AsyncStorage);
    });
  });

  describe('serialize(): size protection', () => {
    const EMPTY_CACHE = '{"clientState":{"queries":[],"mutations":[]}}';

    function callSerialize(data: any): string {
      const fn = persisterCapture().options.serialize as (d: unknown) => string;
      return fn(data);
    }

    it('returns EMPTY_CACHE when clientState has more than 200 queries', () => {
      const queries = Array.from({ length: 201 }, (_, i) => ({
        queryKey: ['x', i],
        state: { data: { id: i } },
      }));
      const data = { clientState: { queries, mutations: [] } };
      expect(callSerialize(data)).toBe(EMPTY_CACHE);
    });

    it('serializes normally when query count is ≤ 200', () => {
      const queries = Array.from({ length: 5 }, (_, i) => ({
        queryKey: ['small', i],
        state: { data: { id: i } },
      }));
      const data = { clientState: { queries, mutations: [] } };
      const out = callSerialize(data);
      expect(out).not.toBe(EMPTY_CACHE);
      expect(out).toContain('"small"');
    });

    it('returns EMPTY_CACHE when serialized payload exceeds 1 MB', () => {
      // 150 queries, each carrying ~10 KB of data → serialized > 1 MB
      const big = 'x'.repeat(10_000);
      const queries = Array.from({ length: 150 }, (_, i) => ({
        queryKey: ['big', i],
        state: { data: { blob: big } },
      }));
      const data = { clientState: { queries, mutations: [] } };
      expect(callSerialize(data)).toBe(EMPTY_CACHE);
    });

    it('returns EMPTY_CACHE when JSON.stringify throws (circular ref)', () => {
      const circular: any = { clientState: { queries: [], mutations: [] } };
      circular.circular = circular;
      expect(callSerialize(circular)).toBe(EMPTY_CACHE);
    });

    it('handles missing clientState gracefully', () => {
      // Defensive: no clientState at all → fall through to stringify path
      const data = { somethingElse: 1 };
      expect(typeof callSerialize(data)).toBe('string');
    });
  });

  describe('persist options passed to PersistQueryClientProvider', () => {
    beforeEach(() => {
      // Mount once so provider props are captured
      render(
        <QueryProvider>
          <></>
        </QueryProvider>
      );
    });

    it('sets maxAge to 24 hours (matches gcTime)', () => {
      expect(providerCapture().props.persistOptions.maxAge).toBe(1000 * 60 * 60 * 24);
    });

    it('attaches the created persister', () => {
      expect(providerCapture().props.persistOptions.persister).toBeDefined();
    });

    it('registers onSuccess and onError callbacks', () => {
      expect(typeof providerCapture().props.onSuccess).toBe('function');
      expect(typeof providerCapture().props.onError).toBe('function');
    });
  });

  describe('dehydrateOptions.shouldDehydrateQuery', () => {
    let shouldDehydrate: (q: any) => boolean;

    beforeEach(() => {
      render(
        <QueryProvider>
          <></>
        </QueryProvider>
      );
      shouldDehydrate =
        providerCapture().props.persistOptions.dehydrateOptions.shouldDehydrateQuery;
    });

    it('returns false for pending queries (would fail on rehydration)', () => {
      const query = {
        queryKey: ['anything'],
        state: { status: 'pending' },
      };
      expect(shouldDehydrate(query)).toBe(false);
    });

    it('returns false for activity-streams-v3 (100-500 KB per activity)', () => {
      const query = {
        queryKey: ['activity-streams-v3', 'a1'],
        state: { status: 'success' },
      };
      expect(shouldDehydrate(query)).toBe(false);
    });

    it('returns false for individual activity queries', () => {
      const query = {
        queryKey: ['activity', 'a1'],
        state: { status: 'success' },
      };
      expect(shouldDehydrate(query)).toBe(false);
    });

    it('returns false for fixed-range activities queries (date params go stale)', () => {
      const query = {
        queryKey: ['activities', { oldest: '2024-01-01' }],
        state: { status: 'success' },
      };
      expect(shouldDehydrate(query)).toBe(false);
    });

    it('returns true for other query keys (e.g., wellness)', () => {
      const query = {
        queryKey: ['wellness', '7d'],
        state: { status: 'success' },
      };
      expect(shouldDehydrate(query)).toBe(true);
    });

    it('returns true for athlete queries', () => {
      const query = {
        queryKey: ['athlete'],
        state: { status: 'success' },
      };
      expect(shouldDehydrate(query)).toBe(true);
    });
  });

  describe('onSuccess: stale infinite activities handling', () => {
    beforeEach(() => {
      render(
        <QueryProvider>
          <></>
        </QueryProvider>
      );
    });

    it('does nothing when infinite activities are fresh', () => {
      mockIsInfiniteActivitiesStale.mockReturnValue(false);
      const resetSpy = jest
        .spyOn(queryClient, 'resetQueries')
        .mockImplementation(() => Promise.resolve());
      providerCapture().props.onSuccess();
      expect(resetSpy).not.toHaveBeenCalled();
      resetSpy.mockRestore();
    });

    it('calls resetQueries when infinite activities are stale', () => {
      mockIsInfiniteActivitiesStale.mockReturnValue(true);
      const resetSpy = jest
        .spyOn(queryClient, 'resetQueries')
        .mockImplementation(() => Promise.resolve());
      providerCapture().props.onSuccess();
      expect(resetSpy).toHaveBeenCalledTimes(1);
      expect(resetSpy.mock.calls[0][0]).toEqual({ queryKey: ['activities-infinite'] });
      resetSpy.mockRestore();
    });
  });

  describe('onError: corrupted cache recovery', () => {
    beforeEach(() => {
      render(
        <QueryProvider>
          <></>
        </QueryProvider>
      );
    });

    it('removes the veloq-query-cache key from AsyncStorage', async () => {
      const removeSpy = jest.spyOn(AsyncStorage, 'removeItem').mockResolvedValue();
      providerCapture().props.onError();
      // Let the promise chain settle
      await Promise.resolve();
      await Promise.resolve();
      expect(removeSpy).toHaveBeenCalledWith('veloq-query-cache');
      removeSpy.mockRestore();
    });

    it('alerts the user after successfully clearing', async () => {
      jest.spyOn(AsyncStorage, 'removeItem').mockResolvedValue();
      const clearSpy = jest.spyOn(queryClient, 'clear');
      providerCapture().props.onError();
      await Promise.resolve();
      await Promise.resolve();
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalledWith(
        'alerts.cacheCleared',
        'alerts.cacheCorruptionMessage',
        expect.any(Array)
      );
      clearSpy.mockRestore();
    });

    it('swallows (does not throw) when AsyncStorage.removeItem also fails', async () => {
      jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk full'));
      // Should not throw synchronously — error is handled in the .catch()
      expect(() => providerCapture().props.onError()).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
      // No Alert.alert because the then-branch didn't execute
      expect(Alert.alert).not.toHaveBeenCalled();
    });
  });

  describe('QueryProvider rendering', () => {
    it('renders children inside the provider', () => {
      render(
        <QueryProvider>
          <></>
        </QueryProvider>
      );
      // Provider must mount without throwing; capture confirms the render path ran
      expect(providerCapture().props.children).toBeDefined();
    });
  });

  describe('AppState ↔ focusManager sync', () => {
    it('registered an AppState change listener at module init', () => {
      expect(capturedAppStateListeners.length).toBeGreaterThan(0);
    });

    it('calls focusManager.setFocused(true) when app becomes active', () => {
      const spy = jest.spyOn(focusManager, 'setFocused').mockImplementation(() => {});
      capturedAppStateListeners[0]('active');
      expect(spy).toHaveBeenCalledWith(true);
      spy.mockRestore();
    });

    it('calls focusManager.setFocused(false) when app goes to background', () => {
      const spy = jest.spyOn(focusManager, 'setFocused').mockImplementation(() => {});
      capturedAppStateListeners[0]('background');
      expect(spy).toHaveBeenCalledWith(false);
      spy.mockRestore();
    });
  });
});
