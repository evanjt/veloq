/**
 * Scenario: an activity detail is open while a sync stores bodies for other
 * activities and other kinds.
 *
 * Expected behaviour: only a `bodyStored` naming this activity and this kind
 * re-reads the stream body. Each re-read is a synchronous parse of 100-500 KB.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useActivityStreams } from '@/features/activity/hooks/useActivities';
import { getEngine } from '@/shared/native/engine';
import { streamBuffers } from '../__shared__/streamBuffers';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const engine = {
  getActivityStreams: jest.fn(() => streamBuffers({ time: [0, 1, 2] })),
  syncActivityStreams: jest.fn(),
  subscribe: jest.fn((_channel: string, _listener: (payload?: unknown) => void) => () => {}),
};

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

function announce(payload: unknown) {
  return act(async () => {
    for (const [channel, listener] of engine.subscribe.mock.calls) {
      if (channel === 'bodyStored') listener(payload);
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.Mock).mockReturnValue(engine);
});

afterEach(() => client.clear());

describe('bodyStored wakes only the body it names', () => {
  it('ignores another activity and another kind, re-reads for its own streams once', async () => {
    const { result } = await renderHook(() => useActivityStreams('a1'), { wrapper });
    await waitFor(() => expect(result.current.isDownloaded).toBe(true));
    const reads = () => engine.getActivityStreams.mock.calls.length;
    const afterFirstPaint = reads();

    await announce({ kind: 'streams', activityId: 'a2' });
    await announce({ kind: 'intervals', activityId: 'a1' });
    await announce({ kind: 'power_curve', activityId: '' });
    expect(reads()).toBe(afterFirstPaint);

    await announce({ kind: 'streams', activityId: 'a1' });
    await waitFor(() => expect(reads()).toBe(afterFirstPaint + 1));
  });
});
