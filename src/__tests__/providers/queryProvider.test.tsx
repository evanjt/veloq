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
// the auth store / queryKeys module tree.
const mockIsInfiniteActivitiesStale = jest.fn().mockReturnValue(false);
jest.mock('@/shared/query/activitiesCache', () => ({
  isInfiniteActivitiesStale: (...args: any[]) => mockIsInfiniteActivitiesStale(...args),
}));

// Minimal queryKeys stub to avoid importing the auth-coupled module tree
jest.mock('@/shared/query/queryKeys', () => ({
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
  require('@/shared/query/QueryProvider') as typeof import('@/shared/query/QueryProvider');
const { QueryProvider } = QueryProviderModule;
const queryClient: QueryClient = QueryProviderModule.queryClient;

describe('QueryProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryClient.clear();
  });

  describe('module-level queryClient configuration', () => {
    it('configures staleTime, gcTime, network mode, retry, and refetch flags', () => {
      const defaults = queryClient.getDefaultOptions().queries!;
      expect(defaults.staleTime).toBe(1000 * 60 * 5);
      // in-memory gcTime 2h; persister maxAge handles cross-launch
      expect(defaults.gcTime).toBe(1000 * 60 * 60 * 2);
      expect(defaults.networkMode).toBe('offlineFirst');
      expect(defaults.retry).toBe(2);
      expect(defaults.refetchOnMount).toBe(false);
      expect(defaults.refetchOnWindowFocus).toBe(false);
      expect(defaults.refetchOnReconnect).toBe(true);
    });
  });

  describe('persister configuration', () => {
    it('uses veloq-query-cache key, 2s throttle, and AsyncStorage', () => {
      const opts = persisterCapture().options;
      expect(opts).not.toBeNull();
      expect(opts.key).toBe('veloq-query-cache');
      expect(opts.throttleTime).toBe(2000);
      expect(opts.storage).toBe(AsyncStorage);
    });
  });

  describe('Serialization & size protection', () => {
    const EMPTY_CACHE = '{"clientState":{"queries":[],"mutations":[]}}';

    function callSerialize(data: any): string {
      const fn = persisterCapture().options.serialize as (d: unknown) => string;
      return fn(data);
    }

    it('falls back to EMPTY_CACHE on count/size/serialization-failure', () => {
      const big = 'x'.repeat(10_000);
      const circular: any = { clientState: { queries: [], mutations: [] } };
      circular.circular = circular;
      const emptyCaseFactories: Array<() => any> = [
        // >200 queries
        () => ({
          clientState: {
            queries: Array.from({ length: 201 }, (_, i) => ({
              queryKey: ['x', i],
              state: { data: { id: i } },
            })),
            mutations: [],
          },
        }),
        // serialized payload > 1 MB (150 × ~10 KB)
        () => ({
          clientState: {
            queries: Array.from({ length: 150 }, (_, i) => ({
              queryKey: ['big', i],
              state: { data: { blob: big } },
            })),
            mutations: [],
          },
        }),
        // JSON.stringify throws on circular ref
        () => circular,
      ];
      for (const make of emptyCaseFactories) {
        expect(callSerialize(make())).toBe(EMPTY_CACHE);
      }
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

    it('sets 24h maxAge, attaches persister, registers onSuccess/onError', () => {
      const props = providerCapture().props;
      expect(props.persistOptions.maxAge).toBe(1000 * 60 * 60 * 24);
      expect(props.persistOptions.persister).toBeDefined();
      expect(typeof props.onSuccess).toBe('function');
      expect(typeof props.onError).toBe('function');
    });
  });

  describe('Cache rehydration filtering', () => {
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

    it('excludes pending/stream/activity/fixed-range; keeps everything else', () => {
      // pending → false regardless of key; streams, single activity, and
      // fixed-range activities excluded; wellness/athlete dehydrated.
      const cases: Array<[unknown[], string, boolean]> = [
        [['anything'], 'pending', false],
        [['activity-streams-v3', 'a1'], 'success', false],
        [['activity', 'a1'], 'success', false],
        [['activities', { oldest: '2024-01-01' }], 'success', false],
        [['wellness', '7d'], 'success', true],
        [['athlete'], 'success', true],
      ];
      for (const [queryKey, status, expected] of cases) {
        expect(shouldDehydrate({ queryKey, state: { status } })).toBe(expected);
      }
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
    it('registers a change listener that maps active/background to focus state', () => {
      expect(capturedAppStateListeners.length).toBeGreaterThan(0);
      const transitions: Array<[string, boolean]> = [
        ['active', true],
        ['background', false],
      ];
      for (const [status, focused] of transitions) {
        const spy = jest.spyOn(focusManager, 'setFocused').mockImplementation(() => {});
        capturedAppStateListeners[0](status);
        expect(spy).toHaveBeenCalledWith(focused);
        spy.mockRestore();
      }
    });
  });
});
