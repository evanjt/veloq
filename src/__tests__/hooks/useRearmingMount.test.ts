/**
 * Scenario: a deferred mount is torn down by a render error.
 * Expected behaviour: it mounts again after the delay, at most the allowed
 * number of times, and a pull-to-refresh style re-render never leaves it down
 * for the life of the screen.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useRearmingMount } from '@/shared/async/useRearmingMount';

describe('useRearmingMount', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('mounts after the start delay', () => {
    const { result } = renderHook(() => useRearmingMount(500, 2));
    expect(result.current.mounted).toBe(false);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current.mounted).toBe(true);
  });

  it('mounts again after the delay when the mounted tree fails', () => {
    const { result } = renderHook(() => useRearmingMount(500, 2));
    act(() => {
      jest.advanceTimersByTime(500);
    });
    act(() => result.current.onError());
    expect(result.current.mounted).toBe(false);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current.mounted).toBe(true);
  });

  it('gives up once the retries are spent', () => {
    const { result } = renderHook(() => useRearmingMount(500, 2));
    act(() => {
      jest.advanceTimersByTime(500);
    });
    for (let i = 0; i < 2; i++) {
      act(() => result.current.onError());
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(result.current.mounted).toBe(true);
    }
    act(() => result.current.onError());
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.mounted).toBe(false);
  });

  it('cancels a pending mount on unmount', () => {
    const { unmount } = renderHook(() => useRearmingMount(500, 2));
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
