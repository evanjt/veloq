/**
 * Scenario: the athlete excludes an attempt from a route, or puts one back.
 *
 * Expected behaviour: the write is followed by a re-read of the screen bundle,
 * so the ranked attempts and the excluded list come from the one read and not
 * from a local copy of the set.
 */

import { act, renderHook } from '@testing-library/react-native';
import { useExcludedActivities } from '@/features/routes/hooks/useExcludedActivities';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/native/useEngineSubscription', () => ({
  useEngineRead:
    () =>
    <T>(read: (engine: unknown) => T) =>
      read({}),
}));

// The bundle's list keeps its identity between reads, as the screen's does.
const NONE: string[] = [];
const ONE = ['a1'];
const TWO = ['a1', 'a2'];

describe('useExcludedActivities write', () => {
  const engine = {
    excludeActivityFromRoute: jest.fn(),
    includeActivityInRoute: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getEngine as jest.Mock).mockReturnValue(engine);
  });

  it('asks for a fresh bundle after an exclusion', () => {
    const onRouteRefresh = jest.fn();
    const { result } = renderHook(() =>
      useExcludedActivities('route-1', undefined, NONE, onRouteRefresh)
    );

    act(() => result.current.handleExcludeActivity('a1'));

    expect(engine.excludeActivityFromRoute).toHaveBeenCalledWith('route-1', 'a1');
    expect(onRouteRefresh).toHaveBeenCalledTimes(1);
  });

  it('asks for a fresh bundle after an inclusion', () => {
    const onRouteRefresh = jest.fn();
    const { result } = renderHook(() =>
      useExcludedActivities('route-1', undefined, ONE, onRouteRefresh)
    );

    act(() => result.current.handleIncludeActivity('a1'));

    expect(engine.includeActivityInRoute).toHaveBeenCalledWith('route-1', 'a1');
    expect(onRouteRefresh).toHaveBeenCalledTimes(1);
  });

  it('takes the excluded set from the bundle it is handed', () => {
    const onRouteRefresh = jest.fn();
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) =>
        useExcludedActivities('route-1', undefined, ids, onRouteRefresh),
      { initialProps: { ids: ONE } }
    );
    expect([...result.current.excludedActivityIds]).toEqual(['a1']);

    act(() => result.current.handleExcludeActivity('a2'));
    expect([...result.current.excludedActivityIds]).toEqual(['a1']);

    rerender({ ids: TWO });
    expect([...result.current.excludedActivityIds]).toEqual(['a1', 'a2']);
  });

  it('writes and refreshes nothing without an engine', () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const onRouteRefresh = jest.fn();
    const { result } = renderHook(() =>
      useExcludedActivities('route-1', undefined, NONE, onRouteRefresh)
    );

    act(() => result.current.handleExcludeActivity('a1'));

    expect(onRouteRefresh).not.toHaveBeenCalled();
  });
});
