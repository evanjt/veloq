import { routes } from 'veloqrs';

import { debug } from '@/shared/debug/debug';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const log = debug.create('RouteGuidance');

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

/** The route the ride follows: the chosen one, for the sport being recorded, in GPS mode. */
function followedRouteId(): string | null {
  const { activityType, mode } = useRecordingStore.getState();
  const choice = useRecordingLiveStore.getState().routeChoice;
  if (mode !== 'gps' || !choice || choice.activityType !== activityType) return null;
  return choice.routeId;
}

/**
 * Holds the ride's route follower for as long as the ride's session does. The follower is
 * built once per followed route and each fix costs one engine call, made from the store
 * subscription and never from render. A change of route, sport or mode drops the follower and
 * the guidance, and so does stopping. Returns the function that stops following.
 */
export function followChosenRoute(): () => void {
  let routeId: string | null = null;
  let stopFollowing: (() => void) | null = null;

  const reconcile = (): void => {
    const wanted = followedRouteId();
    if (wanted === routeId) return;
    routeId = wanted;
    stopFollowing?.();
    stopFollowing = null;
    const { setGuidance, setRouteTurns } = useRecordingLiveStore.getState();
    setGuidance(null);
    setRouteTurns([]);
    if (!wanted) return;
    const follower = buildFollower(wanted);
    if (!follower) return;
    setRouteTurns(follower.turns());
    stopFollowing = followRouteOnFixes(follower);
  };

  const unsubscribeChoice = useRecordingLiveStore.subscribe((state, prev) => {
    if (state.routeChoice !== prev.routeChoice) reconcile();
  });
  const unsubscribeRide = useRecordingStore.subscribe((state, prev) => {
    if (state.activityType !== prev.activityType || state.mode !== prev.mode) reconcile();
  });
  reconcile();

  return () => {
    unsubscribeChoice();
    unsubscribeRide();
    stopFollowing?.();
    stopFollowing = null;
    routeId = null;
  };
}
