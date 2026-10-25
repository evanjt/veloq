/**
 * Scenario: the athlete opens the entry screen for a walk with a location fix and has saved
 * walking routes around them, and later starts the ride.
 *
 * Expected behaviour: every nearby route is drawn and none is followed until one is chosen;
 * following one describes it by name, distance and best time; one call stops following, before
 * the start and during the ride; a choice is kept for its sport only.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useNearbyRouteOverlay } from '@/shared/app/useNearbyRouteOverlay';
import { useRecordingLiveStore } from '@/features/recording';

const mockGetNearby = jest.fn();

jest.mock('veloqrs', () => ({
  ...require('../__shared__/veloqrsStub'),
  routes: { getNearbyRoutesForRecording: (...args: unknown[]) => mockGetNearby(...args) },
  decodeCoords: () => [
    { latitude: 46.5, longitude: 6.6 },
    { latitude: 46.51, longitude: 6.61 },
  ],
}));
jest.mock('@/shared/native/useEngineSubscription', () => {
  // One reader for every render, as the real one is between engine announcements.
  const reader = (read: (engine: unknown) => unknown) => read({});
  return { useEngineRead: () => reader };
});

const route = (groupId: string, over: Record<string, unknown> = {}) => ({
  groupId,
  name: `Route ${groupId}`,
  distanceMeters: 12_400,
  awayMeters: 0,
  bestTimeSeconds: 2_482,
  encodedCoords: new ArrayBuffer(4),
  ...over,
});

const here = { latitude: 46.5, longitude: 6.6 };

beforeEach(() => {
  useRecordingLiveStore.getState().reset();
  mockGetNearby.mockReset();
  mockGetNearby.mockReturnValue([
    route('a'),
    route('b'),
    route('c', { bestTimeSeconds: undefined }),
  ]);
});

const render = (over: Partial<Parameters<typeof useNearbyRouteOverlay>[0]> = {}) =>
  renderHook(() =>
    useNearbyRouteOverlay({ activityType: 'Walk', location: here, enabled: true, ...over })
  );

describe('useNearbyRouteOverlay', () => {
  it('draws every nearby route and follows none until one is chosen', () => {
    const { result } = render();
    expect(result.current.nearby.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.nearby.every((r) => r.points.length === 2)).toBe(true);
    expect(result.current.followed).toBeNull();
  });

  it('follows the chosen route and describes it with its name, distance and best time', () => {
    const { result } = render();
    act(() => result.current.choose('b'));
    expect(result.current.followed).toMatchObject({
      id: 'b',
      name: 'Route b',
      distanceMeters: 12_400,
      bestTimeSeconds: 2_482,
    });
  });

  it('carries no best time for a route without one, not zero', () => {
    const { result } = render();
    act(() => result.current.choose('c'));
    expect(result.current.followed?.bestTimeSeconds).toBeNull();
  });

  it('stops following in one call, before the start and during the ride', () => {
    const entry = render();
    act(() => entry.result.current.choose('a'));
    act(() => entry.result.current.stopFollowing());
    expect(entry.result.current.followed).toBeNull();

    act(() => entry.result.current.choose('a'));
    const live = render();
    expect(live.result.current.followed?.id).toBe('a');
    act(() => live.result.current.stopFollowing());
    expect(live.result.current.followed).toBeNull();
    expect(useRecordingLiveStore.getState().routeChoice).toEqual({
      activityType: 'Walk',
      routeId: null,
    });
  });

  it('asks the engine for the followed route so one outside the radius is still described', () => {
    const { result } = render();
    act(() => result.current.choose('faraway'));
    expect(mockGetNearby).toHaveBeenLastCalledWith(46.5, 6.6, 'Walk', 'faraway');
  });

  it('ignores a choice made for another sport', () => {
    const entry = render();
    act(() => entry.result.current.choose('a'));
    expect(render({ activityType: 'Ride' }).result.current.followed).toBeNull();
  });

  it('offers nothing before a fix and nothing for an indoor sport', () => {
    expect(render({ location: null }).result.current.nearby).toEqual([]);
    expect(render({ enabled: false }).result.current.nearby).toEqual([]);
  });

  it('does not read again for a fix a few metres away', () => {
    const { rerender } = renderHook(
      (location: { latitude: number; longitude: number }) =>
        useNearbyRouteOverlay({ activityType: 'Walk', location, enabled: true }),
      { initialProps: here }
    );
    const calls = mockGetNearby.mock.calls.length;
    rerender({ latitude: 46.50004, longitude: 6.60004 });
    expect(mockGetNearby.mock.calls.length).toBe(calls);
  });
});
