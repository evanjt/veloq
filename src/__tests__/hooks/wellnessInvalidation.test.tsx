/**
 * Scenario: nothing announced wellness, so `useWellness` was woken by the
 * `activities` channel. That channel fires per synced page, measured five times
 * in the first 4.5 s of a launch, and wellness is written once, so each of the
 * three consumers re-read and re-parsed its whole window four times for
 * nothing. A `1y` range is 365 bodies.
 *
 * Expected behaviour: wellness is woken by the wellness announcement and by
 * nothing else. An `activities` event leaves it alone, and a `bodyStored` for
 * some other kind does too.
 */

import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { useWellness } from '@/features/wellness/hooks/useWellness';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

type Listener = (payload?: { kind?: string; activityId?: string }) => void;

const listeners = new Map<string, Set<Listener>>();

const engine = {
  reads: 0,
  getWellnessDays: jest.fn(() => {
    engine.reads += 1;
    return [{ date: '2026-03-01', ctl: 50, sportLoad: [] }];
  }),
  subscribe: jest.fn((event: string, callback: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    listeners.set(event, set);
    set.add(callback);
    return () => set.delete(callback);
  }),
};

function announce(event: string, payload?: { kind?: string }) {
  listeners.get(event)?.forEach((cb) => cb(payload));
}

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  engine.reads = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ isAuthenticated: true });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

async function openWellness() {
  const view = renderHook(() => useWellness('1y'), { wrapper });
  await waitFor(() => expect(view.result.current.data).not.toBeUndefined());
  return view;
}

describe('what wakes a wellness read', () => {
  it('does not re-read on an activities event, which fires per synced page', async () => {
    await openWellness();
    const readsAtOpen = engine.reads;

    await act(async () => {
      announce('activities');
    });

    expect(engine.reads).toBe(readsAtOpen);
  });

  it('re-reads when wellness itself lands', async () => {
    await openWellness();
    const readsAtOpen = engine.reads;

    await act(async () => {
      announce('bodyStored', { kind: 'wellness' });
    });

    await waitFor(() => expect(engine.reads).toBeGreaterThan(readsAtOpen));
  });

  it('ignores a body of some other kind', async () => {
    await openWellness();
    const readsAtOpen = engine.reads;

    await act(async () => {
      announce('bodyStored', { kind: 'activity_detail' });
    });

    expect(engine.reads).toBe(readsAtOpen);
  });
});
