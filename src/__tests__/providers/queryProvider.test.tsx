/**
 * QueryProvider
 *
 * Scenario: every queryFn in the tree reads the on-device engine, which rebuilds
 * any key from SQLite faster than AsyncStorage can be read and parsed.
 * Expected behaviour: a plain client provider with no persister, the first query
 * running on the first render, and a one-time removal of the legacy blob.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import { render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Text } from 'react-native';
import { focusManager, useQuery, type QueryClient } from '@tanstack/react-query';

jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
}));

// The module registers its AppState listener at import time, so the spy has to
// be in place before the deferred require below.
const capturedAppStateListeners: ((status: string) => void)[] = [];
jest.spyOn(AppState, 'addEventListener').mockImplementation((event: any, listener: any) => {
  if (event === 'change') capturedAppStateListeners.push(listener);
  return { remove: jest.fn() } as any;
});

const removeItemSpy = jest.spyOn(AsyncStorage, 'removeItem').mockResolvedValue();
const getItemSpy = jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue(null);

const QueryProviderModule =
  require('@/shared/query/QueryProvider') as typeof import('@/shared/query/QueryProvider');
const { QueryProvider } = QueryProviderModule;
const queryClient: QueryClient = QueryProviderModule.queryClient;
const removalsAtImport = removeItemSpy.mock.calls.map((call) => call[0]);
const readsAtImport = getItemSpy.mock.calls.map((call) => call[0]);

function Probe({ queryFn, cacheKey }: { queryFn: () => Promise<string>; cacheKey: string }) {
  const { data } = useQuery({ queryKey: [cacheKey], queryFn });
  return <Text>{data ?? 'no data'}</Text>;
}

describe('QueryProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryClient.clear();
  });

  describe('client defaults', () => {
    it('configures staleTime, gcTime, network mode, retry, and refetch flags', () => {
      const defaults = queryClient.getDefaultOptions().queries!;
      expect(defaults.staleTime).toBe(1000 * 60 * 5);
      expect(defaults.gcTime).toBe(1000 * 60 * 60 * 2);
      expect(defaults.networkMode).toBe('offlineFirst');
      expect(defaults.retry).toBe(2);
      expect(defaults.refetchOnMount).toBe(false);
      expect(defaults.refetchOnWindowFocus).toBe(false);
      expect(defaults.refetchOnReconnect).toBe(true);
    });
  });

  describe('no persister', () => {
    it('never reads the cache blob back, at import or on mount', () => {
      render(
        <QueryProvider>
          <></>
        </QueryProvider>
      );
      const keysRead = [...readsAtImport, ...getItemSpy.mock.calls.map((call) => call[0])];
      expect(keysRead).not.toContain('veloq-query-cache');
    });

    it('runs the first query on the first render, with no restore step between', () => {
      const queryFn = jest.fn().mockResolvedValue('engine');
      render(
        <QueryProvider>
          <Probe queryFn={queryFn} cacheKey="first" />
        </QueryProvider>
      );
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('mounts the module singleton, so a seeded key is read without a fetch', () => {
      queryClient.setQueryData(['seeded'], 'from cache');
      const queryFn = jest.fn().mockResolvedValue('engine');
      const { getByText } = render(
        <QueryProvider>
          <Probe queryFn={queryFn} cacheKey="seeded" />
        </QueryProvider>
      );
      expect(getByText('from cache')).toBeTruthy();
      expect(queryFn).not.toHaveBeenCalled();
    });
  });

  describe('legacy cache cleanup', () => {
    it('removes the veloq-query-cache blob once, at import', () => {
      expect(removalsAtImport).toEqual(['veloq-query-cache']);
    });

    it('does not remove it again on mount, or on a second mount', () => {
      render(
        <QueryProvider>
          <></>
        </QueryProvider>
      );
      render(
        <QueryProvider>
          <></>
        </QueryProvider>
      );
      expect(removeItemSpy).not.toHaveBeenCalled();
    });

    it('swallows a failed removal', async () => {
      removeItemSpy.mockRejectedValueOnce(new Error('disk full'));
      await expect(QueryProviderModule.clearLegacyQueryCache()).resolves.toBeUndefined();
    });
  });

  describe('rendering', () => {
    it('renders children inside the provider', () => {
      const { getByText } = render(
        <QueryProvider>
          <Text>child marker</Text>
        </QueryProvider>
      );
      expect(getByText('child marker')).toBeTruthy();
    });
  });

  describe('AppState to focusManager sync', () => {
    it('registers a change listener that maps active/background to focus state', () => {
      expect(capturedAppStateListeners.length).toBeGreaterThan(0);
      const transitions: [string, boolean][] = [
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
