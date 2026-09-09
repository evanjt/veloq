/**
 * Scenario: the cache screen shows how many TanStack queries are held. The
 * number was read once at mount, from a dependency that never changes, so it
 * froze at whatever the cache held the first time the screen opened.
 *
 * Expected behaviour: the count follows the cache, throttled so a sync that
 * lands a hundred queries costs one re-render rather than a hundred.
 */

import { act, renderHook } from '@testing-library/react-native';
import { QueryClient } from '@tanstack/react-query';

import {
  useQueryCacheCount,
  QUERY_COUNT_THROTTLE_MS,
} from '@/features/settings/hooks/useQueryCacheCount';

const seed = (client: QueryClient, key: string) =>
  client.getQueryCache().build(client, { queryKey: [key] });

describe('the cached-query count follows the cache', () => {
  let client: QueryClient;

  beforeEach(() => {
    jest.useFakeTimers();
    client = new QueryClient();
  });

  afterEach(() => {
    jest.useRealTimers();
    client.clear();
  });

  it('starts at what the cache already holds', () => {
    seed(client, 'activities');
    seed(client, 'wellness');

    const { result } = renderHook(() => useQueryCacheCount(client));

    expect(result.current).toBe(2);
  });

  it('picks up a query that lands while the screen is open', () => {
    const { result } = renderHook(() => useQueryCacheCount(client));
    expect(result.current).toBe(0);

    act(() => {
      seed(client, 'activities');
      jest.advanceTimersByTime(QUERY_COUNT_THROTTLE_MS);
    });

    expect(result.current).toBe(1);
  });

  it('drops back when the cache is cleared', () => {
    seed(client, 'activities');
    const { result } = renderHook(() => useQueryCacheCount(client));

    act(() => {
      client.clear();
      jest.advanceTimersByTime(QUERY_COUNT_THROTTLE_MS);
    });

    expect(result.current).toBe(0);
  });

  it('coalesces a burst into one sample', () => {
    const { result } = renderHook(() => useQueryCacheCount(client));

    act(() => {
      for (let i = 0; i < 50; i += 1) seed(client, `activities-${i}`);
      jest.advanceTimersByTime(QUERY_COUNT_THROTTLE_MS - 1);
    });
    // Still the mount reading: the burst has not been sampled yet.
    expect(result.current).toBe(0);

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(result.current).toBe(50);
  });

  it('stops sampling once the screen unmounts', () => {
    const { result, unmount } = renderHook(() => useQueryCacheCount(client));
    unmount();

    act(() => {
      seed(client, 'activities');
      jest.advanceTimersByTime(QUERY_COUNT_THROTTLE_MS * 2);
    });

    expect(result.current).toBe(0);
  });
});
