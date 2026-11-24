/**
 * Scenario: the feed's filter bars draw across the library's span, which the
 * engine answers in one read rather than a constant range.
 *
 * Expected behaviour: the hook hands back the engine's answer as it stands, an
 * empty library reaches the panel as no bounds at all, and an engine that is
 * not up yet answers `null` rather than `undefined`, which the query cache
 * refuses.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activities } from 'veloqrs';
import React from 'react';

import { useFeedFilterBounds } from '@/features/activity/hooks/useFeedFilterBounds';

jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => true,
  getEngine: () => ({ subscribe: () => () => {} }),
}));

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    activities: { getFeedFilterBounds: jest.fn() },
  })
);

const mockBounds = activities.getFeedFilterBounds as jest.Mock;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  client.clear();
});

describe('useFeedFilterBounds', () => {
  it('hands back the span the engine answers', async () => {
    const span = {
      oldestTs: 1_700_000_000,
      newestTs: 1_710_000_000,
      minDistance: 1_000,
      maxDistance: 42_000,
      minMovingTime: 600,
      maxMovingTime: 14_400,
    };
    mockBounds.mockReturnValue(span);

    const { result } = renderHook(() => useFeedFilterBounds(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(span));
  });

  it('reaches an empty library as no bounds', async () => {
    mockBounds.mockReturnValue({});

    const { result } = renderHook(() => useFeedFilterBounds(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({}));
  });

  it('answers null while the engine is not up', async () => {
    mockBounds.mockReturnValue(undefined);

    const { result } = renderHook(() => useFeedFilterBounds(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeNull());
  });
});
