/**
 * One timer over one read, for every routes background job being followed.
 *
 * Each job used to carry its own interval over its own export, so a screen
 * following two of them took the engine lock four times a tick and the figures
 * could disagree with each other. Here a tick is one `getRoutesStatusData`,
 * handed to every follower, so two followers cost what one does and they read
 * the same instant.
 *
 * Progress has no observer event on purpose: the binding blocks the Rust
 * thread until JavaScript returns, so a per-item event would park the worker
 * it reports on. That is why this is a timer at all.
 *
 * It lives in `shared/native` beside `useEngineSubscription` rather than in
 * the routes feature, because the settings screen follows the same figures and
 * a second poller over the same read would be the thing this removes.
 */

import { getEngine } from './engine';
import type { RoutesStatus } from 'veloqrs';

/** What the two followed jobs settle within, and what both used before. */
export const ROUTES_STATUS_POLL_MS = 500;

type Follower = (status: RoutesStatus | null) => void;

const followers = new Set<Follower>();
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * One read, now. Null is the engine being unable to answer: a caller reads
 * that its own way, because a count is not a zero and a phase is not idle.
 */
export function readRoutesStatus(): RoutesStatus | null {
  const engine = getEngine();
  if (!engine) return null;
  try {
    return engine.getRoutesStatusData?.() ?? null;
  } catch {
    return null;
  }
}

function tick(): void {
  const status = readRoutesStatus();
  // A copy, so a follower that unfollows inside its own callback does not
  // shorten the iteration the others are in.
  for (const follower of [...followers]) follower(status);
}

/**
 * Follow the figures until the returned function is called. The timer starts
 * with the first follower and stops with the last, so nothing is polled while
 * nothing is being watched.
 */
export function followRoutesStatus(follower: Follower): () => void {
  followers.add(follower);
  if (timer === undefined) {
    timer = setInterval(tick, ROUTES_STATUS_POLL_MS);
  }
  return () => {
    followers.delete(follower);
    if (followers.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Whether a tick is armed. For the tests that assert it disarms. */
export function routesStatusIsFollowed(): boolean {
  return timer !== undefined;
}
