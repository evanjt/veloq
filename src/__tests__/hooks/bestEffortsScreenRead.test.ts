/**
 * Scenario: Best Efforts and Season Bests on Fitness draw the same bests for a
 * period, and each used to read a power or pace curve per sport and pick the
 * checkpoints out of it in TypeScript.
 *
 * Expected behaviour: both read the one engine screen read for the period,
 * neither reads a curve export, and only a curve the read reports as never
 * fetched, for a sport the caller shows, is asked for.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useBestEfforts } from '@/features/stats/hooks/useBestEfforts';
import { useSeasonBests } from '@/features/stats/hooks/useSeasonBests';
import { getEngine } from '@/shared/native/engine';
import type { BestEffortsData } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const engine = {
  getBestEffortsData: jest.fn(),
  getPowerCurve: jest.fn(),
  getPaceCurve: jest.fn(),
  syncPowerCurve: jest.fn(),
  syncPaceCurve: jest.fn(),
  savePaceSnapshot: jest.fn(),
  subscribe: jest.fn(() => () => {}),
  getBodiesStored: jest.fn(() => 0),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

/** Running fetched with a 5K best, cycling and swimming never fetched. */
function screen(): BestEffortsData {
  return {
    sports: [
      {
        sport: 'Ride',
        fetched: false,
        efforts: [{ label: '5m', checkpoint: 300 }],
      },
      {
        sport: 'Run',
        fetched: true,
        efforts: [
          { label: '1K', checkpoint: 1000 },
          { label: '5K', checkpoint: 5000, value: 4, time: 1250, activityId: 'tempo' },
        ],
      },
      {
        sport: 'Swim',
        fetched: false,
        efforts: [{ label: '400m', checkpoint: 400 }],
      },
    ],
    climbing: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getBestEffortsData.mockReturnValue(screen());
});

afterEach(() => {
  client.clear();
});

describe('season bests', () => {
  it('reads the running bests from the screen read and no curve', async () => {
    const { result } = renderHook(() => useSeasonBests({ sport: 'Running', days: 42 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.efforts).toEqual([
      { label: '1K', checkpoint: 1000, value: null, time: null, activityId: undefined },
      { label: '5K', checkpoint: 5000, value: 4, time: 1250, activityId: 'tempo' },
    ]);
    expect(engine.getBestEffortsData).toHaveBeenCalledWith(42);
    expect(engine.getPaceCurve).not.toHaveBeenCalled();
    expect(engine.getPowerCurve).not.toHaveBeenCalled();
  });

  it('asks for the cycling curve only when cycling is shown and it was never fetched', async () => {
    const { result } = renderHook(() => useSeasonBests({ sport: 'Cycling', days: 42 }), {
      wrapper,
    });

    await waitFor(() => expect(engine.syncPowerCurve).toHaveBeenCalledWith('Ride', 42));
    expect(result.current.efforts[0]).toMatchObject({ label: '5m', value: null });
    expect(engine.syncPaceCurve).not.toHaveBeenCalled();
  });

  it('asks for nothing when the shown curve is already stored', async () => {
    const { result } = renderHook(() => useSeasonBests({ sport: 'Running', days: 42 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(engine.syncPaceCurve).not.toHaveBeenCalled();
    expect(engine.syncPowerCurve).not.toHaveBeenCalled();
  });
});

describe('the Best Efforts screen read', () => {
  it('reads every sport in one call and asks only for the curves never fetched', async () => {
    const { result } = renderHook(() => useBestEfforts(0, ['Ride', 'Run', 'Swim']), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    await waitFor(() => expect(engine.syncPowerCurve).toHaveBeenCalledWith('Ride', 0));
    expect(engine.syncPaceCurve).toHaveBeenCalledWith('Swim', 0, false);
    expect(engine.syncPaceCurve).not.toHaveBeenCalledWith('Run', 0, false);
    expect(engine.getBestEffortsData).toHaveBeenCalledTimes(1);
  });

  it('carries a failed read as an error rather than as empty bests', async () => {
    engine.getBestEffortsData.mockImplementation(() => {
      throw new Error('database is locked');
    });

    const { result } = renderHook(() => useBestEfforts(90, ['Run']), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(engine.syncPaceCurve).not.toHaveBeenCalled();
  });
});
