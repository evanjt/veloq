/**
 * Scenario: curves, activity intervals and calendar events are per-parameter
 * fetches the launch sync cannot prefetch. Each read returns what is stored
 * and asks Rust for anything absent, and a body that will not parse must
 * render as "no data" rather than take the chart down.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { usePowerCurve } from '@/features/stats/hooks/usePowerCurve';
import { usePaceCurve } from '@/features/stats/hooks/usePaceCurve';
import { useAthleteSummary } from '@/features/fitness/hooks/useAthleteSummary';
import { parsePaceCurveBody, parsePowerCurveBody } from '@/features/stats/lib/curveBodies';
import { getRouteEngine } from '@/shared/native/routeEngine';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));

const engine = {
  getPowerCurveBody: jest.fn(),
  getPaceCurveBody: jest.fn(),
  syncPowerCurve: jest.fn(),
  syncPaceCurve: jest.fn(),
  savePaceSnapshot: jest.fn(),
  getWeeklySummaries: jest.fn(),
  subscribe: jest.fn(() => () => {}),
  getBodiesStored: jest.fn(() => 0),
  triggerRefresh: jest.fn(),
};

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetRouteEngine.mockReturnValue(engine as unknown as ReturnType<typeof getRouteEngine>);
  engine.getPowerCurveBody.mockReturnValue(null);
  engine.getPaceCurveBody.mockReturnValue(null);
  engine.getWeeklySummaries.mockReturnValue([]);
  useAuthStore.setState({ isAuthenticated: true });
});

afterEach(() => {
  client.clear();
});

describe('curve body parsing', () => {
  it('renames the power curve values to watts', () => {
    const curve = parsePowerCurveBody(
      JSON.stringify({ list: [{ secs: [1, 5], values: [900, 800], activity_id: ['x', 'y'] }] }),
      'Ride'
    );
    expect(curve?.secs).toEqual([1, 5]);
    expect(curve?.watts).toEqual([900, 800]);
    expect(curve?.activity_ids).toEqual(['x', 'y']);
  });

  it('computes pace as distance over time, guarding divide by zero', () => {
    const curve = parsePaceCurveBody(
      JSON.stringify({
        list: [
          {
            distance: [100, 200, 300],
            values: [20, 50, 0],
            paceModels: [{ type: 'CS', criticalSpeed: 2.85, dPrime: 250, r2: 0.99 }],
          },
        ],
      }),
      'Run'
    );
    expect(curve?.pace).toEqual([5, 4, 0]);
    expect(curve?.criticalSpeed).toBe(2.85);
  });

  it('reads an unparseable body as absent', () => {
    expect(parsePowerCurveBody('{broken', 'Ride')).toBeNull();
    expect(parsePaceCurveBody('{broken', 'Run')).toBeNull();
  });
});

describe('usePowerCurve', () => {
  it('asks Rust for a curve it has never stored', async () => {
    renderHook(() => usePowerCurve({ sport: 'Ride', days: 90 }), { wrapper });

    await waitFor(() => expect(engine.syncPowerCurve).toHaveBeenCalledWith('Ride', 90));
  });

  it('does not re-request a curve it already holds', async () => {
    engine.getPowerCurveBody.mockReturnValue(
      JSON.stringify({ list: [{ secs: [1], values: [9] }] })
    );

    const { result } = renderHook(() => usePowerCurve({ sport: 'Ride', days: 90 }), { wrapper });

    await waitFor(() => expect(result.current.data?.watts).toEqual([9]));
    expect(engine.syncPowerCurve).not.toHaveBeenCalled();
  });

  it('renders an empty curve while the fetch is in flight', async () => {
    const { result } = renderHook(() => usePowerCurve({ sport: 'Ride' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.watts).toEqual([]);
  });
});

describe('usePaceCurve', () => {
  it('keys the request on the gap flag', async () => {
    renderHook(() => usePaceCurve({ sport: 'Run', days: 42, gap: true }), { wrapper });

    await waitFor(() => expect(engine.syncPaceCurve).toHaveBeenCalledWith('Run', 42, true));
  });

  it('snapshots critical speed once the curve is stored', async () => {
    engine.getPaceCurveBody.mockReturnValue(
      JSON.stringify({
        list: [{ distance: [100], values: [20], paceModels: [{ type: 'CS', criticalSpeed: 3.4 }] }],
      })
    );

    renderHook(() => usePaceCurve({ sport: 'Run' }), { wrapper });

    await waitFor(() =>
      expect(engine.savePaceSnapshot).toHaveBeenCalledWith(
        'Run',
        3.4,
        undefined,
        undefined,
        expect.any(Number)
      )
    );
  });
});

describe('useAthleteSummary', () => {
  it('derives weeks from the engine rather than fetching them', async () => {
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    engine.getWeeklySummaries.mockReturnValue([
      {
        weekStart: Math.floor(monday.getTime() / 1000),
        count: 0,
        movingTime: 0,
        distance: 0,
        trainingLoad: 0,
      },
      {
        weekStart: Math.floor(monday.getTime() / 1000),
        count: 3,
        movingTime: 7200,
        distance: 60000,
        trainingLoad: 210,
      },
    ]);

    const { result } = renderHook(() => useAthleteSummary(1), { wrapper });

    await waitFor(() => expect(result.current.data.allWeeks.length).toBe(1));
    // Weeks with no activities are dropped, matching what the endpoint returned.
    expect(result.current.data.allWeeks[0].count).toBe(3);
    expect(result.current.data.allWeeks[0].moving_time).toBe(7200);
    expect(result.current.data.allWeeks[0].training_load).toBe(210);
  });

  it('asks for one week per requested Monday plus the current one', async () => {
    renderHook(() => useAthleteSummary(4), { wrapper });

    await waitFor(() => expect(engine.getWeeklySummaries).toHaveBeenCalled());
    const [weekStarts, weekLength] = engine.getWeeklySummaries.mock.calls[0];
    expect(weekStarts).toHaveLength(5);
    expect(weekLength).toBe(7 * 24 * 60 * 60);
  });
});
