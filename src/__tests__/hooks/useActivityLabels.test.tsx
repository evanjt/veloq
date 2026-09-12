/**
 * Expected behaviour: the labels read the ids they are given and no window, and
 * a body landing while the screen is open still fills its row in. The window
 * read this replaced was invalidated on the `activities` channel, so dropping it
 * must not drop that.
 */

import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useActivityLabels } from '@/features/activity/hooks/useActivityLabels';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const bodies: Record<string, string> = {};

const engine = {
  getActivityBodies: jest.fn(() => Object.values(bodies)),
  getActivityBody: jest.fn((id: string) => bodies[id] ?? null),
  subscribe: jest.fn((event: string, callback: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    listeners.set(event, set);
    set.add(callback);
    return () => set.delete(callback);
  }),
};

function land(id: string, name: string) {
  bodies[id] = JSON.stringify({ id, name, start_date_local: '2026-03-01T08:00:00' });
  listeners.get('activities')?.forEach((cb) => cb());
}

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  for (const key of Object.keys(bodies)) delete bodies[key];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

afterEach(() => client.clear());

describe('useActivityLabels', () => {
  it('names the ids it is given without reading a window', async () => {
    land('a1', 'Alpine loop');

    const view = renderHook(() => useActivityLabels(['a1']), { wrapper });

    await waitFor(() => expect(view.result.current.get('a1')?.name).toBe('Alpine loop'));
    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });

  it('fills a row in when its body lands while the screen is open', async () => {
    const view = renderHook(() => useActivityLabels(['a1']), { wrapper });
    await waitFor(() => expect(view.result.current.size).toBe(0));

    await act(async () => {
      land('a1', 'Alpine loop');
    });

    await waitFor(() => expect(view.result.current.get('a1')?.name).toBe('Alpine loop'));
  });

  it('asks the engine nothing when there are no ids to name', async () => {
    renderHook(() => useActivityLabels([]), { wrapper });

    await waitFor(() => expect(engine.subscribe).toHaveBeenCalled());
    expect(engine.getActivityBody).not.toHaveBeenCalled();
    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });
});
