/**
 * Scenario: the athlete follows a saved route while recording and fixes arrive one by one.
 *
 * Expected behaviour: one follower is built per chosen route, each new fix is placed on it once,
 * and the latest record sits in the live store for every readout. Changing or clearing the
 * choice, or resetting the session, drops the old follower and the guidance.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useRecordingLiveStore } from '@/features/recording';
import { useRouteGuidance } from '@/features/recording/hooks/useRouteGuidance';

const mockFollow = jest.fn();
const mockAdvance = jest.fn();

jest.mock('veloqrs', () => ({
  ...require('../__shared__/veloqrsStub'),
  routes: {
    followRoute: (...args: unknown[]) => mockFollow(...args),
    advanceRouteFollower: (...args: unknown[]) => mockAdvance(...args),
  },
}));

const record = (alongM: number) => ({ alongM, remainingM: 1000 - alongM, status: 'OnRoute' });

let followers: Record<string, { id: string }>;

beforeEach(() => {
  useRecordingLiveStore.getState().reset();
  mockFollow.mockReset();
  mockAdvance.mockReset();
  followers = {};
  mockFollow.mockImplementation((id: string) => (followers[id] = { id }));
  mockAdvance.mockImplementation((_f: unknown, lat: number) => record(Math.round(lat * 100)));
});

const fix = (latitude: number) =>
  act(() => useRecordingLiveStore.getState().setFix({ latitude, longitude: 6.6 }, 5));
const choose = (routeId: string | null, sport = 'Ride') =>
  act(() => useRecordingLiveStore.getState().setRouteChoice(sport, routeId));
const render = (enabled = true, sport = 'Ride') =>
  renderHook(() => useRouteGuidance({ activityType: sport, enabled }));

describe('useRouteGuidance', () => {
  it('builds one follower and places each fix on it in order, keeping the last record', () => {
    choose('a');
    render();
    fix(1);
    fix(2);
    fix(3);
    expect(mockFollow).toHaveBeenCalledTimes(1);
    expect(mockFollow).toHaveBeenCalledWith('a');
    expect(mockAdvance.mock.calls.map((c) => c[1])).toEqual([1, 2, 3]);
    expect(mockAdvance.mock.calls.every((c) => c[0] === followers.a)).toBe(true);
    expect(useRecordingLiveStore.getState().guidance).toEqual(record(300));
  });

  it('does not place a fix again on a re-render with the same fix', () => {
    choose('a');
    const { rerender } = render();
    fix(1);
    rerender({});
    rerender({});
    expect(mockAdvance).toHaveBeenCalledTimes(1);
  });

  it('switches to a new follower on a new choice and sends the old one no more fixes', () => {
    choose('a');
    render();
    fix(1);
    choose('b');
    expect(useRecordingLiveStore.getState().guidance).toBeNull();
    fix(2);
    expect(mockFollow).toHaveBeenCalledTimes(2);
    expect(mockAdvance.mock.calls.map((c) => c[0])).toEqual([followers.a, followers.b]);
  });

  it('clears the guidance when the choice becomes no route', () => {
    choose('a');
    render();
    fix(1);
    choose(null);
    expect(useRecordingLiveStore.getState().guidance).toBeNull();
    fix(2);
    expect(mockAdvance).toHaveBeenCalledTimes(1);
  });

  it('clears the guidance when the session resets', () => {
    choose('a');
    render();
    fix(1);
    act(() => useRecordingLiveStore.getState().reset());
    expect(useRecordingLiveStore.getState().guidance).toBeNull();
    fix(2);
    expect(mockAdvance).toHaveBeenCalledTimes(1);
  });

  it('holds no follower for another sport or outside GPS mode', () => {
    choose('a', 'Walk');
    render(true, 'Ride');
    render(false, 'Walk');
    fix(1);
    expect(mockFollow).not.toHaveBeenCalled();
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it('holds no guidance when the engine refuses the route', () => {
    mockFollow.mockImplementation(() => {
      throw new Error('track holds no line');
    });
    choose('a');
    render();
    fix(1);
    expect(mockAdvance).not.toHaveBeenCalled();
    expect(useRecordingLiveStore.getState().guidance).toBeNull();
  });

  it('stops placing fixes on unmount', () => {
    choose('a');
    const { unmount } = render();
    unmount();
    fix(1);
    expect(mockAdvance).not.toHaveBeenCalled();
  });
});
