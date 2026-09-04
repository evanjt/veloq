/**
 * Scenario: a rider opens one activity after another. Each detail brings its
 * body, its intervals and its streams into the query cache.
 *
 * Expected behaviour: an open detail keeps everything it is showing, and a
 * closed one is let go within minutes. SQLite is the source and a re-read is
 * sub-second, so nothing is worth pinning for hours.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useActivity,
  useActivityIntervals,
  useActivityStreams,
} from '@/features/activity/hooks/useActivities';
import { getEngine } from '@/shared/native/engine';
import { queryKeys } from '@/shared/query/queryKeys';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const engine = {
  getActivityBodies: jest.fn(() => [JSON.stringify({ id: 'a1', name: 'Morning ride' })]),
  getIntervalBody: jest.fn(() => JSON.stringify({ icu_intervals: [], icu_groups: [] })),
  getStreamBody: jest.fn(() => JSON.stringify({ time: [0, 1, 2] })),
  syncActivityDetail: jest.fn(),
  syncActivityIntervals: jest.fn(),
  syncActivityStreams: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

/** Longer than the retention window, so anything unmounted is gone. */
const PAST_THE_WINDOW_MS = 6 * 60 * 1000;
/** Inside it, so a step to a neighbour and back is still a cache hit. */
const WITHIN_THE_WINDOW_MS = 3 * 60 * 1000;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  client.clear();
  jest.useRealTimers();
});

async function openDetail() {
  const view = renderHook(() => useActivity('a1'), { wrapper });
  await waitFor(() => expect(view.result.current.data).not.toBeUndefined());
  return view;
}

describe('activity detail retention', () => {
  it('keeps the body an open detail is showing', async () => {
    const view = await openDetail();
    const readsAtOpen = engine.getActivityBodies.mock.calls.length;

    jest.advanceTimersByTime(PAST_THE_WINDOW_MS);

    expect(view.result.current.data).toMatchObject({ id: 'a1' });
    expect(engine.getActivityBodies).toHaveBeenCalledTimes(readsAtOpen);
  });

  it('lets a closed detail go and reads the engine again on reopen', async () => {
    const view = await openDetail();
    const readsAtOpen = engine.getActivityBodies.mock.calls.length;
    view.unmount();

    jest.advanceTimersByTime(PAST_THE_WINDOW_MS);
    await openDetail();

    expect(engine.getActivityBodies.mock.calls.length).toBeGreaterThan(readsAtOpen);
  });

  it('still has the body for a step to a neighbour and back', async () => {
    const view = await openDetail();
    const readsAtOpen = engine.getActivityBodies.mock.calls.length;
    view.unmount();

    jest.advanceTimersByTime(WITHIN_THE_WINDOW_MS);
    await openDetail();

    expect(engine.getActivityBodies).toHaveBeenCalledTimes(readsAtOpen);
  });

  const detailQueries: [string, () => { data: unknown }, readonly unknown[]][] = [
    ['body', () => useActivity('a1'), queryKeys.activities.detail('a1')],
    ['intervals', () => useActivityIntervals('a1'), queryKeys.activities.intervals('a1')],
    ['streams', () => useActivityStreams('a1'), queryKeys.activities.streams('a1')],
  ];

  it.each(detailQueries)(
    'holds the %s of a closed detail for minutes, not hours',
    async (_what, hook, key) => {
      const view = renderHook(hook, { wrapper });
      await waitFor(() => expect(view.result.current.data).not.toBeUndefined());
      view.unmount();

      jest.advanceTimersByTime(WITHIN_THE_WINDOW_MS);
      expect(client.getQueryCache().find({ queryKey: key })).toBeDefined();

      jest.advanceTimersByTime(PAST_THE_WINDOW_MS - WITHIN_THE_WINDOW_MS);
      expect(client.getQueryCache().find({ queryKey: key })).toBeUndefined();
    }
  );
});
