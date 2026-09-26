/**
 * Scenario: a curve chart draws an empty axis. Whether that is an athlete who
 * rode nothing in the window or a window the device never pulled is a
 * different sentence on screen, and both hooks answered the same one.
 *
 * Expected behaviour: the hook carries the engine's three-way answer through to
 * the chart, and never claims a range is empty on no evidence.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RangeCoverage } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { usePowerCurve } from '@/features/stats/hooks/usePowerCurve';
import { usePaceCurve } from '@/features/stats/hooks/usePaceCurve';
import { BODY_WAIT_MS } from '@/shared/native/engineBodies';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const engine = {
  getPowerCurve: jest.fn(),
  getPaceCurve: jest.fn(),
  syncPowerCurve: jest.fn(),
  syncPaceCurve: jest.fn(),
  savePaceSnapshot: jest.fn(),
  rangeCoverage: jest.fn(),
  subscribe: jest.fn(() => () => {}),
  getBodiesStored: jest.fn(() => 0),
  triggerRefresh: jest.fn(),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getPowerCurve.mockReturnValue(null);
  engine.getPaceCurve.mockReturnValue(null);
  engine.rangeCoverage.mockReturnValue(RangeCoverage.Loaded);
  useAuthStore.setState({ isAuthenticated: true });
});

afterEach(() => {
  client.clear();
});

describe('a curve hook carries why its range is empty', () => {
  it('says the range was never downloaded when the census has rows still owed', async () => {
    engine.rangeCoverage.mockReturnValue(RangeCoverage.NotFetched);

    const { result } = renderHook(() => usePowerCurve({ sport: 'Ride', days: 42 }), { wrapper });

    await waitFor(() => expect(result.current.coverage).toBe(RangeCoverage.NotFetched));
    expect(result.current.data.secs).toEqual([]);
  });

  it('says the range is genuinely empty when the census names nothing in it', async () => {
    engine.rangeCoverage.mockReturnValue(RangeCoverage.Empty);

    const { result } = renderHook(() => usePaceCurve({ sport: 'Run', days: 42 }), { wrapper });

    await waitFor(() => expect(result.current.coverage).toBe(RangeCoverage.Empty));
  });

  it('asks the engine for the window the curve covers, both ends resolved', async () => {
    renderHook(() => usePowerCurve({ sport: 'Ride', days: 42 }), { wrapper });

    await waitFor(() => expect(engine.rangeCoverage).toHaveBeenCalled());
    const [oldest, newest] = engine.rangeCoverage.mock.calls[0];
    expect(oldest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(newest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(oldest < newest).toBe(true);
  });

  /** An engine that is not open yet knows nothing, and `Empty` would be a claim. */
  it('does not call a range empty when there is no engine to ask', async () => {
    mockGetEngine.mockReturnValue(undefined as unknown as ReturnType<typeof getEngine>);

    const { result } = renderHook(() => usePowerCurve({ sport: 'Ride', days: 42 }), { wrapper });

    await waitFor(() => expect(result.current.coverage).toBe(RangeCoverage.NotFetched));
  });

  /** A curve that parsed is proof the range is local, whatever the census says. */
  it('reports a stored curve as loaded', async () => {
    engine.getPowerCurve.mockReturnValue({
      sport: 'Ride',
      secs: [1],
      watts: [9],
      models: [],
      activities: {},
      fetchedAt: Date.UTC(2026, 7, 8),
    });

    const { result } = renderHook(() => usePowerCurve({ sport: 'Ride', days: 42 }), { wrapper });

    await waitFor(() => expect(result.current.data.secs.length).toBe(1));
    expect(result.current.coverage).toBe(RangeCoverage.Loaded);
  });
});

const curveHooks = [
  ['power', () => usePowerCurve({ sport: 'Ride' })],
  ['running pace', () => usePaceCurve({ sport: 'Run' })],
  ['swimming pace', () => usePaceCurve({ sport: 'Swim' })],
] as const;

it.each(curveHooks)(
  'keeps a missing %s curve not downloaded after activities arrive',
  async (_, useCurve) => {
    const { result } = renderHook(() => useCurve(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.coverage).toBe(RangeCoverage.NotFetched);
  }
);

it.each(curveHooks)('recognises a stored empty %s curve as loaded', async (_, useCurve) => {
  engine.rangeCoverage.mockReturnValue(RangeCoverage.NotFetched);
  engine.getPowerCurve.mockReturnValue({
    sport: 'Ride',
    secs: [],
    watts: [],
    models: [],
    activities: {},
    fetchedAt: 1,
  });
  engine.getPaceCurve.mockReturnValue({
    sport: 'Run',
    distances: [],
    times: [],
    pace: [],
    activities: {},
    fetchedAt: 1,
  });
  const { result } = renderHook(() => useCurve(), { wrapper });
  await waitFor(() => expect(result.current.fetchedAt).toBe(1));
  expect(result.current.coverage).toBe(RangeCoverage.Loaded);
});

it.each(curveHooks)(
  'keeps a stored nonempty %s curve visible over incomplete activities',
  async (_, useCurve) => {
    engine.rangeCoverage.mockReturnValue(RangeCoverage.NotFetched);
    engine.getPowerCurve.mockReturnValue({
      sport: 'Ride',
      secs: [1],
      watts: [9],
      models: [],
      activities: {},
      fetchedAt: 1,
    });
    engine.getPaceCurve.mockReturnValue({
      sport: 'Run',
      distances: [100],
      times: [20],
      pace: [5],
      activities: {},
      fetchedAt: 1,
    });
    const { result } = renderHook(() => useCurve(), { wrapper });
    await waitFor(() => expect(result.current.fetchedAt).toBe(1));
    expect(result.current.coverage).toBe(RangeCoverage.Loaded);
    expect(result.current.data).toEqual(
      expect.objectContaining(
        'secs' in result.current.data ? { secs: [1], watts: [9] } : { distances: [100], pace: [5] }
      )
    );
  }
);

it.each(curveHooks)(
  'exposes the %s body deadline and retry without claiming no data',
  async (_, useCurve) => {
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() => useCurve(), { wrapper });
      await waitFor(() => expect(result.current.bodyStatus).toBe('waiting'));
      act(() => jest.advanceTimersByTime(BODY_WAIT_MS));
      expect(result.current.bodyStatus).toBe('timedOut');
      expect(result.current.coverage).toBe(RangeCoverage.NotFetched);
      act(() => result.current.retryBody());
      expect(result.current.bodyStatus).toBe('waiting');
      expect(engine.syncPowerCurve.mock.calls.length + engine.syncPaceCurve.mock.calls.length).toBe(
        2
      );
    } finally {
      jest.useRealTimers();
    }
  }
);
