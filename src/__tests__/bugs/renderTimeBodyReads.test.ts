/**
 * Scenario: the curve and interval hooks read a stored body to decide whether
 * to ask Rust for it. That read was made at render, so every re-render of the
 * screen paid an engine call for a value the query already held.
 *
 * Expected behaviour: the body is read once, inside the query, and a re-render
 * with the same inputs makes no further engine call. A body that is absent is
 * still requested once, and one that is present is never requested.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { usePowerCurve } from '@/features/stats/hooks/usePowerCurve';
import { usePaceCurve } from '@/features/stats/hooks/usePaceCurve';
import { useActivityIntervals } from '@/features/activity/hooks/useActivities';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
}));

const engine = {
  getPowerCurveBody: jest.fn(),
  getPaceCurveBody: jest.fn(),
  getIntervalBody: jest.fn(),
  syncPowerCurve: jest.fn(),
  syncPaceCurve: jest.fn(),
  syncActivityIntervals: jest.fn(),
  savePaceSnapshot: jest.fn(),
  subscribe: jest.fn(() => () => {}),
  getBodiesStored: jest.fn(() => 0),
  triggerRefresh: jest.fn(),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

const POWER = JSON.stringify({ list: [{ secs: [1], values: [9] }] });
const PACE = JSON.stringify({ list: [{ distance: [100], values: [20] }] });
const INTERVALS = JSON.stringify({ icu_intervals: [{ id: 1 }] });

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getPowerCurveBody.mockReturnValue(null);
  engine.getPaceCurveBody.mockReturnValue(null);
  engine.getIntervalBody.mockReturnValue(null);
  useAuthStore.setState({ isAuthenticated: true });
});

afterEach(() => {
  client.clear();
});

describe('usePowerCurve', () => {
  it('reads the stored body once across re-renders', async () => {
    engine.getPowerCurveBody.mockReturnValue(POWER);

    const { result, rerender } = renderHook(() => usePowerCurve({ sport: 'Ride', days: 90 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.watts).toEqual([9]));
    rerender({});
    rerender({});

    expect(engine.getPowerCurveBody).toHaveBeenCalledTimes(1);
    expect(engine.syncPowerCurve).not.toHaveBeenCalled();
  });

  it('still asks once for a body it has never stored, and reads it once', async () => {
    const { result, rerender } = renderHook(() => usePowerCurve({ sport: 'Ride', days: 90 }), {
      wrapper,
    });
    await waitFor(() => expect(engine.syncPowerCurve).toHaveBeenCalledWith('Ride', 90));
    await waitFor(() => expect(result.current.data?.watts).toEqual([]));
    rerender({});

    expect(engine.syncPowerCurve).toHaveBeenCalledTimes(1);
    expect(engine.getPowerCurveBody).toHaveBeenCalledTimes(1);
  });

  it('reads once more when the sport changes, not once per render', async () => {
    engine.getPowerCurveBody.mockReturnValue(POWER);

    const { result, rerender } = renderHook(
      ({ sport }: { sport: string }) => usePowerCurve({ sport, days: 90 }),
      { wrapper, initialProps: { sport: 'Ride' } }
    );
    await waitFor(() => expect(result.current.data?.watts).toEqual([9]));
    rerender({ sport: 'MountainBikeRide' });
    await waitFor(() => expect(result.current.data?.sport).toBe('MountainBikeRide'));
    rerender({ sport: 'MountainBikeRide' });

    expect(engine.getPowerCurveBody).toHaveBeenCalledTimes(2);
  });
});

describe('usePaceCurve', () => {
  it('reads the stored body once across re-renders', async () => {
    engine.getPaceCurveBody.mockReturnValue(PACE);

    const { result, rerender } = renderHook(() => usePaceCurve({ sport: 'Run', days: 42 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.pace).toEqual([5]));
    rerender({});
    rerender({});

    expect(engine.getPaceCurveBody).toHaveBeenCalledTimes(1);
    expect(engine.syncPaceCurve).not.toHaveBeenCalled();
  });

  it('still asks once for a body it has never stored', async () => {
    renderHook(() => usePaceCurve({ sport: 'Run', days: 42, gap: true }), { wrapper });

    await waitFor(() => expect(engine.syncPaceCurve).toHaveBeenCalledWith('Run', 42, true));
    expect(engine.syncPaceCurve).toHaveBeenCalledTimes(1);
  });
});

describe('useActivityIntervals', () => {
  it('reads the stored body once across re-renders', async () => {
    engine.getIntervalBody.mockReturnValue(INTERVALS);

    const { result, rerender } = renderHook(() => useActivityIntervals('a1'), { wrapper });
    await waitFor(() => expect(result.current.data?.icu_intervals).toHaveLength(1));
    rerender({});
    rerender({});

    expect(engine.getIntervalBody).toHaveBeenCalledTimes(1);
    expect(engine.syncActivityIntervals).not.toHaveBeenCalled();
  });

  it('still asks once for intervals it has never stored', async () => {
    const { result, rerender } = renderHook(() => useActivityIntervals('a1'), { wrapper });

    await waitFor(() => expect(engine.syncActivityIntervals).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(result.current.data?.icu_intervals).toEqual([]));
    rerender({});

    expect(engine.syncActivityIntervals).toHaveBeenCalledTimes(1);
  });

  it('reads nothing and asks for nothing without an id', async () => {
    const { rerender } = renderHook(() => useActivityIntervals(''), { wrapper });
    rerender({});

    expect(engine.getIntervalBody).not.toHaveBeenCalled();
    expect(engine.syncActivityIntervals).not.toHaveBeenCalled();
  });
});
