/**
 * Scenario: the wellness charts cannot tell wellness never downloaded from a
 * range that holds none, so both drew the same instruction to log wellness.
 *
 * Expected behaviour: the coverage hook answers what the engine says beside
 * the days of exactly the window `useWellness` reads, from the same read rather
 * than a second one, and `NotFetched` before an answer, signed out, or with the
 * read refused.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { useWellness, useWellnessCoverage } from '@/features/wellness/hooks/useWellness';
import { formatLocalDate } from '@/shared/format/format';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const engine = {
  getWellnessDays: jest.fn((_oldest: string, _newest: string) => ({
    days: [] as { date: string; sportLoad: [] }[],
    coverage: RangeCoverage.NotFetched,
  })),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ isAuthenticated: true });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  client.clear();
});

describe('useWellnessCoverage', () => {
  it('answers the coverage of the thirty days back to today that the month range draws', async () => {
    engine.getWellnessDays.mockReturnValue({ days: [], coverage: RangeCoverage.Empty });

    const { result } = await renderHook(() => useWellnessCoverage('1m'), { wrapper });

    await waitFor(() => expect(result.current).toBe(RangeCoverage.Empty));
    const today = new Date();
    const oldest = new Date(today);
    oldest.setDate(oldest.getDate() - 30);
    expect(engine.getWellnessDays).toHaveBeenCalledWith(
      formatLocalDate(oldest),
      formatLocalDate(today)
    );
  });

  it('shares one read with the days of the same range', async () => {
    engine.getWellnessDays.mockReturnValue({
      days: [{ date: '2026-06-01', sportLoad: [] }],
      coverage: RangeCoverage.Loaded,
    });

    const { result } = await renderHook(
      () => ({ days: useWellness('1m'), coverage: useWellnessCoverage('1m') }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.coverage).toBe(RangeCoverage.Loaded));
    expect(result.current.days.data?.map((d) => d.id)).toEqual(['2026-06-01']);
    expect(engine.getWellnessDays).toHaveBeenCalledTimes(1);
  });

  it('answers not downloaded while the engine is not open', async () => {
    mockGetEngine.mockReturnValue(undefined as unknown as ReturnType<typeof getEngine>);

    const { result } = await renderHook(
      () => ({ days: useWellness('1m'), coverage: useWellnessCoverage('1m') }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.days.isSuccess).toBe(true));
    expect(result.current.coverage).toBe(RangeCoverage.NotFetched);
  });

  it('answers not downloaded when the engine refuses the read', async () => {
    engine.getWellnessDays.mockImplementation(() => {
      throw new Error('engine closed');
    });

    const { result } = await renderHook(
      () => ({ days: useWellness('1m'), coverage: useWellnessCoverage('1m') }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.days.isError).toBe(true));
    expect(result.current.coverage).toBe(RangeCoverage.NotFetched);
  });

  it('answers not downloaded signed out, without reading', async () => {
    useAuthStore.setState({ isAuthenticated: false });

    const { result } = await renderHook(() => useWellnessCoverage('1m'), { wrapper });

    expect(result.current).toBe(RangeCoverage.NotFetched);
    expect(engine.getWellnessDays).not.toHaveBeenCalled();
  });
});
