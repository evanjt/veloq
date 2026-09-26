/**
 * Scenario: curves, activity intervals and calendar events are per-parameter
 * fetches the launch sync cannot prefetch. Each read returns what is stored
 * and asks Rust for anything absent.
 *
 * The bodies are parsed by the engine (`persistence/curves.rs`), which answers
 * `null` both for a window never fetched and for a body that will not parse,
 * so a broken body renders as "no data" rather than taking the chart down.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { usePowerCurve } from '@/features/stats/hooks/usePowerCurve';
import { usePaceCurve } from '@/features/stats/hooks/usePaceCurve';
import { useAthleteSummary } from '@/features/fitness/hooks/useAthleteSummary';
import { getEngine } from '@/shared/native/engine';
import type { PaceCurveRow, PowerCurveRow } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const engine = {
  getPowerCurve: jest.fn(),
  getPaceCurve: jest.fn(),
  syncPowerCurve: jest.fn(),
  syncPaceCurve: jest.fn(),
  savePaceSnapshot: jest.fn(),
  getWeeklySummaries: jest.fn(),
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
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getPowerCurve.mockReturnValue(null);
  engine.getPaceCurve.mockReturnValue(null);
  engine.getWeeklySummaries.mockReturnValue([]);
  useAuthStore.setState({ isAuthenticated: true });
});

afterEach(() => {
  client.clear();
});

/** A stored curve carries the time it was fetched, epoch millis. */
const FETCHED_AT = Date.UTC(2026, 7, 8);

/** What the engine hands back for a stored power curve. */
function powerCurve(): PowerCurveRow {
  return {
    sport: 'Ride',
    secs: [1],
    watts: [9],
    models: [],
    activities: {},
    fetchedAt: FETCHED_AT,
  };
}

function paceCurve(extra: Partial<PaceCurveRow> = {}): PaceCurveRow {
  return {
    sport: 'Run',
    distances: [100],
    times: [20],
    pace: [5],
    activities: {},
    fetchedAt: FETCHED_AT,
    ...extra,
  };
}

describe('usePowerCurve', () => {
  it('asks Rust for a curve it has never stored', async () => {
    renderHook(() => usePowerCurve({ sport: 'Ride', days: 90 }), { wrapper });

    await waitFor(() => expect(engine.syncPowerCurve).toHaveBeenCalledWith('Ride', 90));
  });

  it('does not re-request a curve it already holds', async () => {
    engine.getPowerCurve.mockReturnValue(powerCurve());

    const { result } = renderHook(() => usePowerCurve({ sport: 'Ride', days: 90 }), { wrapper });

    await waitFor(() => expect(result.current.data?.watts).toEqual([9]));
    expect(engine.syncPowerCurve).not.toHaveBeenCalled();
  });

  it('hands back the time the stored body was fetched', async () => {
    engine.getPowerCurve.mockReturnValue(powerCurve());

    const { result } = renderHook(() => usePowerCurve({ sport: 'Ride', days: 90 }), { wrapper });

    await waitFor(() => expect(result.current.fetchedAt).toBe(FETCHED_AT));
  });

  it('has no fetch time for a curve it has never stored', async () => {
    const { result } = renderHook(() => usePowerCurve({ sport: 'Ride' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.fetchedAt).toBeNull();
  });

  it('reports nothing stored when the engine cannot answer with a curve', async () => {
    // A body that will not parse reaches here as `null`, the same answer as a
    // window never fetched: neither is a curve to draw.
    engine.getPowerCurve.mockReturnValue(null);

    const { result } = renderHook(() => usePowerCurve({ sport: 'Ride' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.fetchedAt).toBeNull();
    expect(result.current.data?.watts).toEqual([]);
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

  it('asks Rust for nothing while it is disabled', async () => {
    // The fitness screen holds a Run and a Swim curve for its threshold
    // readouts, and only the sport in view renders one. A disabled curve that
    // still fetched cost a download and a `curve_bodies` row per time range.
    renderHook(() => usePaceCurve({ sport: 'Swim', days: 42, enabled: false }), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.syncPaceCurve).not.toHaveBeenCalled();
    expect(engine.savePaceSnapshot).not.toHaveBeenCalled();
  });

  it('snapshots critical speed once the curve is stored', async () => {
    engine.getPaceCurve.mockReturnValue(paceCurve({ criticalSpeed: 3.4 }));

    renderHook(() => usePaceCurve({ sport: 'Run', days: 365 }), { wrapper });

    await waitFor(() =>
      expect(engine.savePaceSnapshot).toHaveBeenCalledWith(
        'Run',
        3.4,
        // The range the screen is showing, not the sync's. The pace milestone
        // compares one window, so a year curve's critical speed has to arrive
        // labelled as one rather than sitting where the sync's would.
        365,
        undefined,
        undefined,
        expect.any(Number)
      )
    );
  });

  /// A curve fetched weeks ago is still the reading it was, so opening the app
  /// must not date it to today: the row is keyed on the date, and a new date
  /// is a new point on the Lactate Threshold trend.
  it('dates the snapshot from the curve, not from the day it was read', async () => {
    engine.getPaceCurve.mockReturnValue(
      paceCurve({
        criticalSpeed: 3.4,
        startDate: '2026-06-27T00:00:00',
        endDate: '2026-08-08T00:00:00',
      })
    );

    renderHook(() => usePaceCurve({ sport: 'Run' }), { wrapper });

    await waitFor(() => expect(engine.savePaceSnapshot).toHaveBeenCalled());
    const stampedAt = engine.savePaceSnapshot.mock.calls[0][5];
    expect(stampedAt).toBe(Math.floor(new Date(2026, 7, 8).getTime() / 1000));
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
