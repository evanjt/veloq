import { useEffect } from 'react';
import { routes } from 'veloqrs';

import { debug } from '@/shared/debug/debug';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';

const log = debug.create('RouteGuidance');

interface Options {
  /** The sport being recorded; a choice made for another sport is not followed. */
  activityType: string;
  /** False outside GPS recording, where no follower is held. */
  enabled: boolean;
}

type Follower = NonNullable<ReturnType<typeof routes.followRoute>>;

function buildFollower(routeId: string): Follower | null {
  try {
    return routes.followRoute(routeId) ?? null;
  } catch (e) {
    // empty-on-error: a route the engine refuses (unknown, or a track with no line) is
    // followed by nothing, and the ride records as if no route had been chosen.
    log.warn('Could not follow route:', e);
    return null;
  }
}

/**
 * Places each fix of the ride on the chosen route and keeps the latest record in the live
 * store, where the map and every readout select it. The follower is built once per choice and
 * each fix costs one engine call, made from the store subscription and never from render.
 */
export function useRouteGuidance({ activityType, enabled }: Options): void {
  const choice = useRecordingLiveStore((s) => s.routeChoice);
  const routeId = enabled && choice?.activityType === activityType ? choice.routeId : null;

  useEffect(() => {
    const { setGuidance } = useRecordingLiveStore.getState();
    setGuidance(null);
    if (!routeId) return undefined;
    const follower = buildFollower(routeId);
    if (!follower) return undefined;

    return useRecordingLiveStore.subscribe((state, prev) => {
      if (state.currentLocation === prev.currentLocation) return;
      const fix = state.currentLocation;
      if (!fix) {
        state.setGuidance(null);
        return;
      }
      state.setGuidance(routes.advanceRouteFollower(follower, fix.latitude, fix.longitude));
    });
  }, [routeId]);
}
