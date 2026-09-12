/**
 * Scenario: the chart on an activity detail is scrubbed, so the screen
 * re-renders on every touch move.
 *
 * Expected behaviour: a re-render costs no engine call. The stored stream body
 * is 100-500 KB, reading it runs a `JSON.parse` and a SQLite `updated_at`
 * write under the engine write lock, and the gesture budget is one frame.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useActivityStreams } from '@/features/activity/hooks/useActivities';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const engine = {
  getStreamBody: jest.fn(() => JSON.stringify({ time: [0, 1, 2] })),
  syncActivityStreams: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => client.clear());

describe('the streams hook reads the body once', () => {
  it('costs nothing on a re-render', async () => {
    const { result, rerender } = renderHook(() => useActivityStreams('a1'), { wrapper });
    await waitFor(() => expect(result.current.data?.time).toEqual([0, 1, 2]));

    const afterFirstPaint = engine.getStreamBody.mock.calls.length;
    for (let frame = 0; frame < 20; frame++) rerender(undefined);

    expect(engine.getStreamBody.mock.calls.length).toBe(afterFirstPaint);
  });

  it('reads the body once for the first paint, not twice', async () => {
    const { result } = renderHook(() => useActivityStreams('a1'), { wrapper });
    await waitFor(() => expect(result.current.data?.time).toEqual([0, 1, 2]));

    expect(engine.getStreamBody).toHaveBeenCalledTimes(1);
  });

  /** Nothing stored is the cue to ask Rust, and it must still fire exactly once. */
  it('asks the engine for a body it does not hold, once', async () => {
    engine.getStreamBody.mockReturnValue(null as unknown as string);

    const { rerender } = renderHook(() => useActivityStreams('a2'), { wrapper });
    await waitFor(() => expect(engine.syncActivityStreams).toHaveBeenCalled());
    for (let frame = 0; frame < 5; frame++) rerender(undefined);

    expect(engine.syncActivityStreams).toHaveBeenCalledTimes(1);
  });

  /** An empty id is a screen with nothing open, and reads nothing at all. */
  it('reads nothing without an id', async () => {
    renderHook(() => useActivityStreams(''), { wrapper });

    expect(engine.getStreamBody).not.toHaveBeenCalled();
    expect(engine.syncActivityStreams).not.toHaveBeenCalled();
  });
});
