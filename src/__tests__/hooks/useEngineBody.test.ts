/**
 * Scenario: an on-demand body settles on a Rust thread. The hook awaiting it
 * read a counter over the bridge twice a second until the count moved, so a
 * chart open on a slow connection paid an FFI read per tick for nothing.
 *
 * Expected behaviour: the hook asks once, then waits for the engine to
 * announce the landing. No engine call happens between the request and the
 * event.
 */

import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useEngineBody } from '@/shared/native/engineBodies';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function fakeEngine() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    announce: (channel: string) => listeners.get(channel)?.forEach((cb) => cb()),
    getBodiesStored: jest.fn(() => 0),
    triggerRefresh: jest.fn(),
    subscribe: jest.fn((channel: string, cb: () => void) => {
      const set = listeners.get(channel) ?? new Set<() => void>();
      listeners.set(channel, set);
      set.add(cb);
      return () => set.delete(cb);
    }),
  };
}

const KEY = ['body', 'a1'];

let client: QueryClient;
let engine: ReturnType<typeof fakeEngine>;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  engine = fakeEngine();
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  client.clear();
  jest.useRealTimers();
});

it('asks once and then makes no engine call on a timer', () => {
  const request = jest.fn();
  renderHook(() => useEngineBody(false, request, KEY), { wrapper });

  expect(request).toHaveBeenCalledTimes(1);
  const before = engine.subscribe.mock.calls.length;

  act(() => {
    jest.advanceTimersByTime(30_000);
  });

  expect(engine.getBodiesStored).not.toHaveBeenCalled();
  expect(engine.triggerRefresh).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  expect(engine.subscribe.mock.calls.length).toBe(before);
});

it('invalidates its query when the engine announces a landing', () => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });

  act(() => {
    engine.announce('bodyStored');
  });

  expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
});

it('still invalidates on the coarse activities channel', () => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  renderHook(() => useEngineBody(true, jest.fn(), KEY), { wrapper });

  act(() => {
    engine.announce('activities');
  });

  expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
});

it('does not ask for a body that is already present', () => {
  const request = jest.fn();
  renderHook(() => useEngineBody(true, request, KEY), { wrapper });

  expect(request).not.toHaveBeenCalled();
});

it('does nothing at all when disabled', () => {
  const request = jest.fn();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  renderHook(() => useEngineBody(false, request, KEY, false), { wrapper });

  act(() => {
    engine.announce('bodyStored');
    engine.announce('activities');
  });

  expect(request).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

it('drops every subscription on unmount', () => {
  const { unmount } = renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });
  unmount();

  const live = [...engine.listeners.values()].reduce((n, set) => n + set.size, 0);
  expect(live).toBe(0);
});

it('leaves a second reader subscribed when the first unmounts', () => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const first = renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });
  renderHook(() => useEngineBody(false, jest.fn(), ['body', 'a2']), { wrapper });
  first.unmount();
  invalidate.mockClear();

  act(() => {
    engine.announce('bodyStored');
  });

  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['body', 'a2'] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: KEY });
});

it('still asks when the engine is not up yet, and subscribes to nothing', () => {
  mockGetEngine.mockReturnValue(undefined as unknown as ReturnType<typeof getEngine>);
  const request = jest.fn();
  const { unmount } = renderHook(() => useEngineBody(false, request, KEY), { wrapper });

  expect(request).toHaveBeenCalledTimes(1);
  expect(engine.subscribe).not.toHaveBeenCalled();
  expect(() => unmount()).not.toThrow();
});
