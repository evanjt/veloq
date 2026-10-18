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

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/native/useEngineSubscription', () => ({
  useEngineRead:
    () =>
    <T>(read: (engine: unknown) => T) =>
      read({}),
}));

describe('useExcludedActivities write', () => {
  const engine = {
    excludeActivityFromRoute: jest.fn(),
    includeActivityInRoute: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getEngine as jest.Mock).mockReturnValue(engine);
  });

  it('asks for a fresh bundle after an exclusion', async () => {
    const onRouteRefresh = jest.fn();
    const { result } = await renderHook(() => useExcludedActivities('route-1', onRouteRefresh));

    await act(() => result.current.handleExcludeActivity('a1'));

    expect(engine.excludeActivityFromRoute).toHaveBeenCalledWith('route-1', 'a1');
    expect(onRouteRefresh).toHaveBeenCalledTimes(1);
  });

  it('asks for a fresh bundle after an inclusion', async () => {
    const onRouteRefresh = jest.fn();
    const { result } = await renderHook(() => useExcludedActivities('route-1', onRouteRefresh));

    await act(() => result.current.handleIncludeActivity('a1'));

    expect(engine.includeActivityInRoute).toHaveBeenCalledWith('route-1', 'a1');
    expect(onRouteRefresh).toHaveBeenCalledTimes(1);
  });

  it('writes and refreshes nothing without an engine', async () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const onRouteRefresh = jest.fn();
    const { result } = await renderHook(() => useExcludedActivities('route-1', onRouteRefresh));

    await act(() => result.current.handleExcludeActivity('a1'));

    expect(onRouteRefresh).not.toHaveBeenCalled();
  });
});
