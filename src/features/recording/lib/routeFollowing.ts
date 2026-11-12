import { routes } from 'veloqrs';

import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';

type Follower = Parameters<typeof routes.advanceRouteFollower>[0];

/**
 * Place every fix the live store receives on a route follower, and keep the latest record in
 * the store. Fixes reach the store from the foreground watch and from the background location
 * task, so this follows the store rather than either source, and runs with the screen off.
 * Returns the function that stops following.
 */
export function followRouteOnFixes(follower: Follower): () => void {
  return useRecordingLiveStore.subscribe((state, prev) => {
    if (state.currentLocation === prev.currentLocation) return;
    const fix = state.currentLocation;
    if (!fix) {
      state.setGuidance(null);
      return;
    }
    state.setGuidance(routes.advanceRouteFollower(follower, fix.latitude, fix.longitude));
  });
}
