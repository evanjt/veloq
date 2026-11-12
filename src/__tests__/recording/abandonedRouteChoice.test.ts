/**
 * Scenario: the athlete picks a saved route on the entry screen, then leaves the screen without
 * starting, and later opens it again somewhere else.
 *
 * Expected behaviour: leaving without starting forgets the choice; leaving by starting the ride
 * keeps it for the live screen.
 */

import { renderHook } from '@testing-library/react-native';

import { useRecordingLiveStore, useRecordingStore } from '@/features/recording';
import { useForgetAbandonedRouteChoice } from '@/features/recording/hooks/useForgetAbandonedRouteChoice';

beforeEach(() => useRecordingLiveStore.getState().reset());

describe('useForgetAbandonedRouteChoice', () => {
  it('forgets a choice when the screen is left without starting', () => {
    const started = { current: false };
    const { unmount } = renderHook(() => useForgetAbandonedRouteChoice(started));
    useRecordingLiveStore.getState().setRouteChoice('Ride', 'a');
    unmount();
    expect(useRecordingLiveStore.getState().routeChoice).toBeNull();
  });

  it('keeps the choice when the screen is left by starting the ride', () => {
    const started = { current: false };
    const { unmount } = renderHook(() => useForgetAbandonedRouteChoice(started));
    useRecordingLiveStore.getState().setRouteChoice('Ride', 'a');
    started.current = true;
    unmount();
    expect(useRecordingLiveStore.getState().routeChoice).toEqual({
      activityType: 'Ride',
      routeId: 'a',
    });
  });

  it('keeps the choice of a ride already under way when the screen redirects to it', () => {
    useRecordingStore.setState({ status: 'recording' });
    const { unmount } = renderHook(() => useForgetAbandonedRouteChoice({ current: false }));
    useRecordingLiveStore.getState().setRouteChoice('Ride', 'a');
    unmount();
    useRecordingStore.setState({ status: 'idle' });
    expect(useRecordingLiveStore.getState().routeChoice?.routeId).toBe('a');
  });

  it('forgets nothing when no route was chosen', () => {
    const { unmount } = renderHook(() => useForgetAbandonedRouteChoice({ current: false }));
    unmount();
    expect(useRecordingLiveStore.getState().routeChoice).toBeNull();
  });
});
